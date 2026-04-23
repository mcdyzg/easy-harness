# Harness Debug Log 设计

## 背景与动机

现状：easy-harness 有多个长驻进程（polling / scheduler）和若干同步流程（hooks、recovery、tmux 命令、store CRUD、notice 发送、session-log 解析），但排查问题时可观测性分散：

- `polling.ts` / `scheduler.ts` 的 `log()` 直写 console，tmux 后台运行时拿不到
- `recovery.ts` 写 `$CLAUDE_PLUGIN_ROOT/log/recovery.log`，路径与 `.harness/` 脱钩
- `hooks.ts` 仅在失败时 `console.error`
- `tmux.ts` / `store.ts` / `notice.ts` / `session-log.ts` 几乎无日志

目标：在 `.harness/config.json` 加一个 `debug` 开关，开启时各关键模块将结构化日志追加写入 `.harness/debug.log`，关闭时零 I/O 开销。

## 非目标

- **不**迁移或删除既有 `recovery.log`、console 输出（并联叠加，不替换）
- **不**引入日志级别（trace/debug/info/warn/error）或模块过滤
- **不**引入日志轮转 / 大小限制（用户自行 `rm`）
- **不**引入新的日志依赖（如 pino）
- **不**改动 `.harness/config.json` 既有字段（`hooks` / `schedules`）

## 配置契约

`.harness/config.json` 新增顶层布尔字段 `debug`：

```jsonc
{
  "debug": true,
  "hooks": { /* 既有 */ },
  "schedules": [ /* 既有 */ ]
}
```

- 缺省值：`false`
- 类型严格匹配：`cfg.debug === true` 才启用；`"true"`、`1` 等不算
- 配置不存在 / 解析失败：视为 `false`

## 架构

```
┌───────────────────────────────────────┐
│  src/utils/debug-log.ts  (新增)         │
│  • debugLog(module, event, kv?)        │
│  • 内部：进程内缓存 flag + lazy 写文件    │
│  • _resetDebugCache() 仅测试使用         │
└─────────────┬─────────────────────────┘
              │ import + 调用
              ▼
┌───────────────────────────────────────┐
│  8 个埋点模块                          │
│  hooks / polling / scheduler /         │
│  recovery / tmux / store /             │
│  notice / session-log                  │
└─────────────┬─────────────────────────┘
              │ fs.appendFileSync
              ▼
         .harness/debug.log
```

运行时语义：

- `debug=false`：`debugLog` 调用在首行 flag 判断后 early-return，无文件 I/O
- `debug=true`：每次调用同步 `fs.appendFileSync('.harness/debug.log', line)`
- 依赖 POSIX `O_APPEND` 语义保证行级原子性；polling 与 scheduler 同时写也不加锁

## Helper 模块：`src/utils/debug-log.ts`

### 公开接口

```ts
export function debugLog(
  module: string,
  event: string,
  kv?: Record<string, unknown>
): void;

// 仅测试用
export function _resetDebugCache(): void;
```

### baseDir 选择

统一使用 `process.cwd()`，与 `TodoStore` 的 baseDir 定位方式一致。所有 skills / scripts 均以项目根为 cwd 运行，因此 `.harness/debug.log` 总是落在项目工作区，而非插件安装目录（`CLAUDE_PLUGIN_ROOT`）。

### 缓存策略

- 模块级变量 `cached = { enabled, logPath }`
- 首次调用解析 `.harness/config.json`，结果永久缓存
- 粒度 = per process：polling / scheduler 等长驻进程内不变，短脚本自然重启重读
- 不监听文件变化；修改 config 后需重启进程生效

### 行格式

```
[<ISO-8601 ts>] [<module>] <event>[ <key>=<value>]*
```

示例：

```
[2026-04-23T10:15:32.123Z] [polling] trigger id=abc123 tmuxSessionId=harness-abc123 title="实现登录"
[2026-04-23T10:15:32.456Z] [hooks]  hook-ok event=todo-create index=0 durationMs=132
[2026-04-23T10:15:32.789Z] [tmux]   exec-ok cmd="tmux send-keys -t harness-abc123 '...'"
```

### `formatKv` 规则

- 字符串不含空格 / 引号 / 控制字符 → `key=value`
- 字符串含空格或特殊字符 → `key="escaped"`（双引号转义：`"` → `\"`，换行 → `\n`）
- 数字 / 布尔 → `key=42` / `key=true`
- `undefined` → 跳过该键
- `null` → `key=null`
- 对象 / 数组 → `key=<JSON.stringify>`；若失败（循环引用等） → `key=<unserializable>`
- 顺序：保留 `Object.keys(kv)` 原序（调用方传 literal，顺序稳定）

### 实现骨架

```ts
import fs from "node:fs";
import path from "node:path";

let cached: { enabled: boolean; logPath: string } | undefined;

function resolve(baseDir: string) {
  if (cached) return cached;
  const configPath = path.join(baseDir, ".harness", "config.json");
  let enabled = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    enabled = cfg.debug === true;
  } catch {
    // 配置不存在 / 解析失败 → 关
  }
  cached = { enabled, logPath: path.join(baseDir, ".harness", "debug.log") };
  return cached;
}

function formatKv(kv: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(kv)) {
    const v = kv[k];
    if (v === undefined) continue;
    parts.push(`${k}=${formatValue(v)}`);
  }
  return parts.join(" ");
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return needsQuote(v) ? quote(v) : v;
  try {
    return JSON.stringify(v);
  } catch {
    return "<unserializable>";
  }
}

function needsQuote(s: string): boolean {
  return /[\s"=\\]/.test(s) || s.length === 0;
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function debugLog(
  module: string,
  event: string,
  kv?: Record<string, unknown>
): void {
  const { enabled, logPath } = resolve(process.cwd());
  if (!enabled) return;

  const ts = new Date().toISOString();
  const kvStr = kv ? " " + formatKv(kv) : "";
  const line = `[${ts}] [${module}] ${event}${kvStr}\n`;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line);
  } catch {
    // 写失败不影响主流程
  }
}

export function _resetDebugCache(): void {
  cached = undefined;
}
```

## 埋点清单

### `services/hooks.ts`

```ts
debugLog("hooks", "config-missing", { path: configPath });     // 提前返回分支
debugLog("hooks", "event-dispatch", { event, hookCount });
debugLog("hooks", "hook-exec",      { event, index, type, detail }); // detail = command 或 skill 名
debugLog("hooks", "hook-ok",        { event, index, durationMs });
debugLog("hooks", "hook-fail",      { event, index, error });
```

### `services/polling.ts`

```ts
debugLog("polling", "start",        { cwd, intervalMinutes, queue });
debugLog("polling", "tick-begin",   { focusIndex, queueLen });
debugLog("polling", "tick-decision",{ actions: actions.map(a => a.type) });
debugLog("polling", "trigger",      { id, tmuxSessionId, title });
debugLog("polling", "skip",         { id, reason });
debugLog("polling", "send-keys-ok", { id, durationMs });
debugLog("polling", "send-keys-fail",{ id, error });
debugLog("polling", "terminate",    { reason });
```

既有 `log()` 调用保持不变，`debugLog` 并联叠加。

### `services/scheduler.ts`

```ts
debugLog("scheduler", "start",           { count });
debugLog("scheduler", "schedule-loaded", { name, cron, type, detail });
debugLog("scheduler", "fire",            { name });
debugLog("scheduler", "fire-ok",         { name, durationMs });
debugLog("scheduler", "fire-fail",       { name, durationMs, error });
```

### `services/recovery.ts`

```ts
debugLog("recovery", "enter",       { todoId, aliveNow, action });
debugLog("recovery", "resume-try",  { todoId, cmd });
debugLog("recovery", "resume-ok",   { todoId, urlCaptured });
debugLog("recovery", "resume-fail", { todoId, error });
debugLog("recovery", "fresh-try",   { todoId, cmd });
debugLog("recovery", "fresh-ok",    { todoId, urlCaptured });
debugLog("recovery", "fresh-fail",  { todoId, error });
```

注：既有 `recovery.log`（`$CLAUDE_PLUGIN_ROOT/log/recovery.log`）保持不变，此处是额外镜像到 `.harness/debug.log`。

### `services/tmux.ts`

仅对副作用函数埋点（`createTmuxSession` / `sendKeysToSession`）：

```ts
export function sendKeysToSession(sessionName: string, text: string): void {
  const cmd = buildSendKeysCommand(sessionName, text);
  debugLog("tmux", "exec", { cmd });
  try {
    execSync(cmd);
    debugLog("tmux", "exec-ok", { cmd });
  } catch (e) {
    debugLog("tmux", "exec-fail", { cmd, error: (e as Error).message });
    throw e;
  }
}
```

`buildClaudeCommand` / `buildCreateSessionCommand` / `buildSendKeysCommand` / `parseTmuxSessionId` 是纯函数，不埋点。

### `store.ts`

```ts
debugLog("store", "add",    { id, title, status });
debugLog("store", "update", { id, keys: Object.keys(updates) });   // 不打 value，避免内容泄漏
debugLog("store", "delete", { id });
```

### `services/notice.ts`

`ConsoleMessageSender.send` 内：

```ts
debugLog("notice", "send", { title, status, tmuxSessionId });
```

### `services/session-log.ts`

```ts
debugLog("session-log", "lookup",   { sessionId, found: !!filePath });
debugLog("session-log", "parse-ok", { filePath, hasUser: !!lastUser, hasAssistant: !!lastAssistant });
```

### 不埋点的地方

- 所有纯函数（`buildXxxCommand`、`parseTmuxSessionId`、`parseRemoteControlUrl`、`extractTextContent`、`tick`、`decideRecoveryAction`、`validateSchedules`、`formatNoticeMessage`、`buildFirstMessage`）
- `utils/id.ts` / `utils/lookup.ts`
- `types.ts`

## 错误处理

| 故障点 | 行为 |
|---|---|
| `.harness/config.json` 不存在 | debug 视为 off |
| config JSON 解析失败 | debug 视为 off，不抛错 |
| `.harness/` 目录不存在 | 首次写时 `mkdirSync({ recursive: true })` |
| `appendFileSync` 失败（权限、磁盘满） | 静默吞掉 |
| `JSON.stringify` 循环引用 | 退化为 `key=<unserializable>` |
| 多进程并发写 | 依赖 `O_APPEND` 行级原子，不加锁 |

核心原则：**debug 日志是观测设施，永远不能通过抛错或阻塞影响主流程。**

## 测试

### 新增 `tests/debug-log.test.ts`

测试 helper 本身：

- `disabled when config missing` → 无文件产生
- `disabled when debug=false` → 无文件产生
- `disabled when debug field absent` → 无文件产生
- `enabled when debug=true` → `.harness/debug.log` 出现一行 `[ts] [mod] evt`
- `creates .harness/ directory if missing` → 自动 mkdir
- `kv formatting: string with space is quoted` → `key="a b"`
- `kv formatting: number/boolean unquoted` → `n=42 b=true`
- `kv formatting: undefined skipped` → `a=1`（b 不出现）
- `kv formatting: null` → `k=null`
- `kv formatting: object serialized` → `k={"a":1}`
- `kv formatting: circular ref` → `k=<unserializable>`
- `survives appendFileSync throwing` → 不抛错
- `caches config read` → 连续两次 `debugLog` 仅读一次 `config.json`

每个 case 用临时目录 + `process.chdir` + `_resetDebugCache()` 隔离。

### 冒烟测试：`tests/store-debug.test.ts`

调 `TodoStore.add({...})` 后断言 `.harness/debug.log` 含 `[store] add id=`。只覆盖 store 一个埋点模块作为代表；其余埋点站靠代码评审保证。

### 不测

- console 既有行为（未改）
- 多进程并发写顺序（依赖 OS）
- 日志文件体积增长后的表现（无 rotation）

## README 更新

在 `README.md` 的 `Customization` 节追加一小段：

```md
### Debug 日志

在 `.harness/config.json` 中设置 `"debug": true`，即可在 `.harness/debug.log`
追加记录 hooks、polling、scheduler、recovery、tmux、store、notice、session-log
各模块的结构化日志，便于排查问题。关闭时零 I/O 开销。修改 config 后需重启
polling / scheduler 进程生效。日志无自动轮转，需自行 `rm` 清理。
```

## 发布

- 按既有节奏更新 `package.json` 版本号（0.1.28）
- 不需要迁移脚本（debug 字段缺省即兼容既有 config）
