# Harness Debug Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `.harness/config.json` 加一个布尔 `debug` 开关；开启时 8 个关键模块（hooks / polling / scheduler / recovery / tmux / store / notice / session-log）把结构化日志追加写入 `.harness/debug.log`；关闭时零 I/O 开销。

**Architecture:** 单一 helper `src/utils/debug-log.ts` 暴露 `debugLog(module, event, kv?)`；内部缓存 `.harness/config.json` 的 `debug` 布尔值；各模块在关键副作用处调用 helper。与现有 console / `recovery.log` 输出并联，不替换。

**Tech Stack:** TypeScript 5.7, vitest 3, Node 22, tsx。

**Spec:** `docs/superpowers/specs/2026-04-23-harness-debug-log-design.md`

---

## File Map

- **Create**: `src/utils/debug-log.ts` — helper 主体
- **Create**: `tests/utils/debug-log.test.ts` — helper 单元测试
- **Create**: `tests/store-debug.test.ts` — store 埋点冒烟测试（代表其余 7 个模块）
- **Modify**: `src/store.ts` — add / update / delete 埋点
- **Modify**: `src/services/hooks.ts` — 事件分发 + 每个 hook exec/ok/fail 埋点
- **Modify**: `src/services/tmux.ts` — `createTmuxSession` / `sendKeysToSession` 埋点
- **Modify**: `src/services/notice.ts` — `ConsoleMessageSender.send` 埋点
- **Modify**: `src/services/session-log.ts` — lookup / parse-ok 埋点
- **Modify**: `src/services/recovery.ts` — 决策 + resume/fresh 分支埋点
- **Modify**: `src/services/polling.ts` — start / tick / trigger / skip / terminate 埋点
- **Modify**: `src/services/scheduler.ts` — start / schedule-loaded / fire 埋点
- **Modify**: `README.md` — 新增 Debug 日志小节
- **Modify**: `package.json` — 版本 0.1.27 → 0.1.28

---

## Task 1: 创建 debug-log helper（TDD）

**Files:**
- Create: `src/utils/debug-log.ts`
- Test: `tests/utils/debug-log.test.ts`

- [ ] **Step 1: 写全部失败测试**

创建 `tests/utils/debug-log.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { debugLog, _resetDebugCache } from "../../src/utils/debug-log.js";

describe("debugLog", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-debug-log-test-"));
    fs.mkdirSync(path.join(tmpDir, ".harness"), { recursive: true });
    process.chdir(tmpDir);
    _resetDebugCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const logPath = () => path.join(tmpDir, ".harness", "debug.log");
  const writeConfig = (cfg: unknown) =>
    fs.writeFileSync(path.join(tmpDir, ".harness", "config.json"), JSON.stringify(cfg));

  it("disabled when config missing", () => {
    debugLog("mod", "evt");
    expect(fs.existsSync(logPath())).toBe(false);
  });

  it("disabled when debug=false", () => {
    writeConfig({ debug: false });
    debugLog("mod", "evt");
    expect(fs.existsSync(logPath())).toBe(false);
  });

  it("disabled when debug field absent", () => {
    writeConfig({ hooks: {} });
    debugLog("mod", "evt");
    expect(fs.existsSync(logPath())).toBe(false);
  });

  it("disabled when debug is truthy but not strictly true", () => {
    writeConfig({ debug: 1 });
    debugLog("mod", "evt");
    expect(fs.existsSync(logPath())).toBe(false);
  });

  it("enabled when debug=true writes one line", () => {
    writeConfig({ debug: true });
    debugLog("mod", "evt");
    const content = fs.readFileSync(logPath(), "utf-8");
    expect(content).toMatch(/^\[[\d:T.Z-]+\] \[mod\] evt\n$/);
  });

  it("appends rather than overwrites", () => {
    writeConfig({ debug: true });
    debugLog("mod", "a");
    debugLog("mod", "b");
    const lines = fs.readFileSync(logPath(), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("] a");
    expect(lines[1]).toContain("] b");
  });

  it("creates .harness/ directory if missing before first write", () => {
    writeConfig({ debug: true });
    // 模拟：config 读取成功缓存后，.harness/ 被删了又要写
    _resetDebugCache();
    debugLog("mod", "evt"); // 此次读 config 成功，目录还在
    fs.rmSync(path.join(tmpDir, ".harness"), { recursive: true, force: true });
    debugLog("mod", "evt2"); // 此次目录没了但缓存仍 enabled，helper 应 mkdir 再写
    expect(fs.existsSync(logPath())).toBe(true);
  });

  it("kv: simple string no quoting", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: "abc" });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e a=abc");
  });

  it("kv: string with space is quoted", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: "a b" });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain('e a="a b"');
  });

  it("kv: string with quote escaped", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: 'x"y' });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain('e a="x\\"y"');
  });

  it("kv: empty string is quoted", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: "" });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain('e a=""');
  });

  it("kv: number and boolean unquoted", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { n: 42, b: true });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e n=42 b=true");
  });

  it("kv: undefined is skipped", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: 1, b: undefined, c: 2 });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e a=1 c=2");
  });

  it("kv: null rendered as null", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: null });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e a=null");
  });

  it("kv: object serialized as JSON", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: { x: 1 } });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain('e a={"x":1}');
  });

  it("kv: array serialized as JSON", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: [1, 2] });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e a=[1,2]");
  });

  it("kv: circular reference yields <unserializable>", () => {
    writeConfig({ debug: true });
    const o: Record<string, unknown> = {};
    o.self = o;
    debugLog("m", "e", { a: o });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e a=<unserializable>");
  });

  it("kv: preserves insertion order", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { z: 1, a: 2, m: 3 });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e z=1 a=2 m=3");
  });

  it("survives appendFileSync throwing", () => {
    writeConfig({ debug: true });
    _resetDebugCache();
    const spy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(() => debugLog("m", "e")).not.toThrow();
    spy.mockRestore();
  });

  it("caches config — reads config.json only once", () => {
    writeConfig({ debug: true });
    _resetDebugCache();
    const spy = vi.spyOn(fs, "readFileSync");
    debugLog("m", "a");
    debugLog("m", "b");
    debugLog("m", "c");
    const configReads = spy.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).endsWith("config.json")
    );
    expect(configReads).toHaveLength(1);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 运行测试确认全部失败**

Run: `npm test -- tests/utils/debug-log.test.ts`
Expected: 所有 case FAIL，原因是 `Cannot find module '../../src/utils/debug-log.js'`。

- [ ] **Step 3: 写 helper 实现**

创建 `src/utils/debug-log.ts`：

```ts
import fs from "node:fs";
import path from "node:path";

// 模块级缓存：首次调用解析 .harness/config.json 后永久保留
let cached: { enabled: boolean; logPath: string } | undefined;

function resolve(baseDir: string): { enabled: boolean; logPath: string } {
  if (cached) return cached;
  const configPath = path.join(baseDir, ".harness", "config.json");
  let enabled = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    enabled = cfg?.debug === true;
  } catch {
    // 配置不存在 / 解析失败 → 关
  }
  cached = { enabled, logPath: path.join(baseDir, ".harness", "debug.log") };
  return cached;
}

function needsQuote(s: string): boolean {
  return s.length === 0 || /[\s"=\\]/.test(s);
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
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

function formatKv(kv: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(kv)) {
    const v = kv[k];
    if (v === undefined) continue;
    parts.push(`${k}=${formatValue(v)}`);
  }
  return parts.join(" ");
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

// 仅测试使用：清空缓存让下次调用重新读 config
export function _resetDebugCache(): void {
  cached = undefined;
}
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `npm test -- tests/utils/debug-log.test.ts`
Expected: 所有 case PASS。

- [ ] **Step 5: 确认既有测试不受影响**

Run: `npm test`
Expected: 全量 PASS。

- [ ] **Step 6: commit**

```bash
git add src/utils/debug-log.ts tests/utils/debug-log.test.ts
git commit -m "feat(utils): add debug-log helper gated by .harness/config.json

- debugLog(module, event, kv?) — no-op when debug=false
- fs.appendFileSync to .harness/debug.log when debug=true
- plain-text key=value format with escape rules"
```

---

## Task 2: 接入 `store.ts` + 冒烟测试

**Files:**
- Modify: `src/store.ts:40-65`
- Create: `tests/store-debug.test.ts`

- [ ] **Step 1: 写冒烟测试**

创建 `tests/store-debug.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TodoStore } from "../src/store.js";
import { _resetDebugCache } from "../src/utils/debug-log.js";
import type { TodoItem } from "../src/types.js";

describe("store debug-log smoke", () => {
  let tmpDir: string;
  let originalCwd: string;
  let store: TodoStore;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-store-debug-"));
    fs.mkdirSync(path.join(tmpDir, ".harness"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".harness", "config.json"),
      JSON.stringify({ debug: true })
    );
    process.chdir(tmpDir);
    _resetDebugCache();
    store = new TodoStore(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeTodo = (overrides: Partial<TodoItem> = {}): TodoItem => ({
    id: "smoke-1",
    title: "Smoke",
    description: "desc",
    status: "pending",
    tmuxSessionId: "",
    remoteControlUrl: "",
    claudeSessionId: "",
    claudeSessionName: "",
    firstMessageSent: false,
    ...overrides,
  });

  const readLog = () =>
    fs.readFileSync(path.join(tmpDir, ".harness", "debug.log"), "utf-8");

  it("add emits [store] add", () => {
    store.add(makeTodo());
    expect(readLog()).toMatch(/\[store\] add id=smoke-1/);
  });

  it("update emits [store] update with keys list", () => {
    store.add(makeTodo());
    store.update("smoke-1", { status: "running", tmuxSessionId: "t-1" });
    expect(readLog()).toMatch(/\[store\] update id=smoke-1 keys=\["status","tmuxSessionId"\]/);
  });

  it("delete emits [store] delete", () => {
    store.add(makeTodo());
    store.delete("smoke-1");
    expect(readLog()).toMatch(/\[store\] delete id=smoke-1/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/store-debug.test.ts`
Expected: 3 个 case FAIL — `.harness/debug.log` 文件不存在（store 还没埋点）。

- [ ] **Step 3: 接入 store.ts**

Edit `src/store.ts`。在文件头 `import` 区追加：

```ts
import { debugLog } from "./utils/debug-log.js";
```

改 `add` 方法（原 40-48 行）：

```ts
add(todo: TodoItem): void {
  const items = this.read();
  const normalized = { ...todo };
  if (normalized.metadata && Object.keys(normalized.metadata).length === 0) {
    delete normalized.metadata;
  }
  items.push(normalized);
  this.write(items);
  debugLog("store", "add", { id: todo.id, title: todo.title, status: todo.status });
}
```

改 `update` 方法（原 50-60 行）：

```ts
update(id: string, updates: Partial<Omit<TodoItem, "id">>): void {
  const items = this.read();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;
  const merged = { ...items[index], ...updates };
  if (merged.metadata && Object.keys(merged.metadata).length === 0) {
    delete merged.metadata;
  }
  items[index] = merged;
  this.write(items);
  debugLog("store", "update", { id, keys: Object.keys(updates) });
}
```

改 `delete` 方法（原 62-65 行）：

```ts
delete(id: string): void {
  const items = this.read().filter((item) => item.id !== id);
  this.write(items);
  debugLog("store", "delete", { id });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全量 PASS，包括 `tests/store-debug.test.ts` 3 个 case 与既有 `tests/store.test.ts`。

- [ ] **Step 5: commit**

```bash
git add src/store.ts tests/store-debug.test.ts
git commit -m "feat(store): emit debug logs for add/update/delete"
```

---

## Task 3: 接入 `services/hooks.ts`

**Files:**
- Modify: `src/services/hooks.ts`

- [ ] **Step 1: 改 hooks.ts**

Edit `src/services/hooks.ts`。文件头新增 import（紧跟 `execSync` 那行之后）：

```ts
import { debugLog } from "../utils/debug-log.js";
```

在 `runHooks` 函数里，找到 `const payloadJson = JSON.stringify(payload);`（约 56 行）**之前**插入：

```ts
  debugLog("hooks", "event-dispatch", { event, hookCount: hooks.length });
```

改整个 `for (const hook of hooks)` 循环（原 58-78 行）为：

```ts
  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i];
    const start = Date.now();
    try {
      if (hook.type === "command") {
        debugLog("hooks", "hook-exec", { event, index: i, type: "command", detail: hook.command });
        execSync(hook.command, {
          input: payloadJson,
          stdio: ["pipe", "pipe", "pipe"],
        });
        debugLog("hooks", "hook-ok", { event, index: i, durationMs: Date.now() - start });
      } else if (hook.type === "skill") {
        const skillName = hook.skill || hook.command;
        if (!skillName) continue;
        debugLog("hooks", "hook-exec", { event, index: i, type: "skill", detail: skillName });
        const escaped = payloadJson.replace(/'/g, "'\\''");
        execSync(`claude -p '调用 ${skillName} skill，参数：${escaped}'`, {
          stdio: ["pipe", "pipe", "pipe"],
        });
        debugLog("hooks", "hook-ok", { event, index: i, durationMs: Date.now() - start });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog("hooks", "hook-fail", { event, index: i, error: msg });
      console.error(`[harness-hooks] ${event} hook 执行失败: ${msg}`);
    }
  }
```

- [ ] **Step 2: 运行既有测试**

Run: `npm test -- tests/services/hooks.test.ts`
Expected: 既有 case 全 PASS（埋点对外部行为无影响）。

- [ ] **Step 3: commit**

```bash
git add src/services/hooks.ts
git commit -m "feat(hooks): emit debug logs for event-dispatch/hook-exec/ok/fail"
```

---

## Task 4: 接入 `services/tmux.ts`

**Files:**
- Modify: `src/services/tmux.ts`

- [ ] **Step 1: 改 tmux.ts**

Edit `src/services/tmux.ts`。文件头新增 import（紧跟第 1 行之后）：

```ts
import { debugLog } from "../utils/debug-log.js";
```

改 `createTmuxSession`（原 46-49 行）：

```ts
export function createTmuxSession(options: CreateSessionOptions): void {
  const cmd = buildCreateSessionCommand(options);
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

改 `sendKeysToSession`（原 51-54 行）：

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

`buildClaudeCommand` / `buildCreateSessionCommand` / `buildSendKeysCommand` / `parseTmuxSessionId` 不改。

- [ ] **Step 2: 运行既有测试**

Run: `npm test -- tests/services/tmux.test.ts`
Expected: PASS（埋点仅新增副作用调用，原逻辑等价）。

- [ ] **Step 3: commit**

```bash
git add src/services/tmux.ts
git commit -m "feat(tmux): emit debug logs around createTmuxSession/sendKeysToSession"
```

---

## Task 5: 接入 `services/notice.ts`

**Files:**
- Modify: `src/services/notice.ts`

- [ ] **Step 1: 改 notice.ts**

Edit `src/services/notice.ts`。文件头新增 import（紧跟第 1 行之后）：

```ts
import { debugLog } from "../utils/debug-log.js";
```

改 `ConsoleMessageSender.send`（原 21-25 行）：

```ts
export class ConsoleMessageSender implements MessageSender {
  async send(message: NoticeMessage): Promise<void> {
    debugLog("notice", "send", {
      title: message.title,
      status: message.status,
      tmuxSessionId: message.tmuxSessionId,
    });
    console.log(formatNoticeMessage(message));
  }
}
```

- [ ] **Step 2: 运行既有测试**

Run: `npm test -- tests/services/notice.test.ts`
Expected: PASS。

- [ ] **Step 3: commit**

```bash
git add src/services/notice.ts
git commit -m "feat(notice): emit debug log in ConsoleMessageSender.send"
```

---

## Task 6: 接入 `services/session-log.ts`

**Files:**
- Modify: `src/services/session-log.ts`

- [ ] **Step 1: 改 session-log.ts**

Edit `src/services/session-log.ts`。文件头新增 import（紧跟 `import os` 那行之后）：

```ts
import { debugLog } from "../utils/debug-log.js";
```

改 `getLastConversationTurn`（原 30-79 行），在函数末尾 `return undefined;` **之前**、在找到成功对后的 `return { userMessage, assistantMessage };` **之前** 都调一次 debugLog。更简单的做法：包一层，让所有返回路径集中。重写函数如下：

```ts
export function getLastConversationTurn(
  filePath: string
): ConversationTurn | undefined {
  if (!fs.existsSync(filePath)) {
    debugLog("session-log", "parse-ok", { filePath, hasUser: false, hasAssistant: false });
    return undefined;
  }

  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
  let lastUser: string | undefined;
  let lastAssistant: string | undefined;

  for (let i = lines.length - 1; i >= 0; i--) {
    const entry: JournalEntry = JSON.parse(lines[i]);

    if (
      !lastAssistant &&
      entry.type === "assistant" &&
      entry.message?.content
    ) {
      lastAssistant = extractTextContent(entry.message.content);
    }

    if (
      lastAssistant &&
      !lastUser &&
      entry.type === "user" &&
      entry.message?.role === "user"
    ) {
      const content = entry.message.content;
      if (typeof content === "string") {
        lastUser = content;
      } else if (
        Array.isArray(content) &&
        content.some((b) => b.type === "text")
      ) {
        lastUser = extractTextContent(content);
      } else {
        continue;
      }
    }

    if (lastUser && lastAssistant) {
      debugLog("session-log", "parse-ok", { filePath, hasUser: true, hasAssistant: true });
      return { userMessage: lastUser, assistantMessage: lastAssistant };
    }
  }

  debugLog("session-log", "parse-ok", {
    filePath,
    hasUser: !!lastUser,
    hasAssistant: !!lastAssistant,
  });
  return undefined;
}
```

改 `findSessionLogFile`（原 81-102 行），把函数改写为：

```ts
export function findSessionLogFile(
  sessionId: string
): string | undefined {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeDir)) {
    debugLog("session-log", "lookup", { sessionId, found: false });
    return undefined;
  }

  const projectDirs = fs.readdirSync(claudeDir);
  for (const projectDir of projectDirs) {
    const projectPath = path.join(claudeDir, projectDir);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const sessionFile = path.join(projectPath, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionFile)) {
      debugLog("session-log", "lookup", { sessionId, found: true });
      return sessionFile;
    }
  }

  debugLog("session-log", "lookup", { sessionId, found: false });
  return undefined;
}
```

- [ ] **Step 2: 运行既有测试**

Run: `npm test -- tests/services/session-log.test.ts`
Expected: PASS。

- [ ] **Step 3: commit**

```bash
git add src/services/session-log.ts
git commit -m "feat(session-log): emit debug logs for lookup/parse-ok"
```

---

## Task 7: 接入 `services/recovery.ts`

**Files:**
- Modify: `src/services/recovery.ts`

- [ ] **Step 1: 改 recovery.ts**

Edit `src/services/recovery.ts`。文件头新增 import（紧跟第 6 行 `import { TodoStore }` 之后）：

```ts
import { debugLog } from "../utils/debug-log.js";
```

改 `ensureSessionAlive`（原 52-110 行）：

```ts
export function ensureSessionAlive(
  cwd: string,
  todo: TodoItem,
  deps: RecoveryDeps
): void {
  let lastExecError = "";

  const aliveNow = deps.sessionExists(todo.tmuxSessionId);
  const action = decideRecoveryAction(todo, aliveNow);
  debugLog("recovery", "enter", { todoId: todo.id, aliveNow, action });
  if (action === "noop") return;

  if (action === "resume") {
    const cmd = buildResumeCommand(todo);
    debugLog("recovery", "resume-try", { todoId: todo.id, cmd });
    try {
      deps.exec(cmd);
    } catch (e) {
      lastExecError = (e as Error).message;
    }
    deps.sleep(2000);
    if (deps.sessionExists(todo.tmuxSessionId)) {
      const pane = deps.capturePane(todo.tmuxSessionId);
      const url = parseRemoteControlUrl(pane);
      if (url) {
        deps.updateTodo(todo.id, { remoteControlUrl: url });
      }
      debugLog("recovery", "resume-ok", { todoId: todo.id, urlCaptured: !!url });
      deps.log(
        `${new Date().toISOString()} todo=${todo.id} branch=A result=ok`
      );
      return;
    }
    debugLog("recovery", "resume-fail", { todoId: todo.id, error: lastExecError });
    deps.log(
      `${new Date().toISOString()} todo=${todo.id} branch=A result=failed, falling back to B`
    );
  }

  // 分支 B
  lastExecError = "";
  const freshCmd = buildFreshSpawnCommand(todo);
  debugLog("recovery", "fresh-try", { todoId: todo.id, cmd: freshCmd });
  try {
    deps.exec(freshCmd);
  } catch (e) {
    lastExecError = (e as Error).message;
  }
  deps.sleep(2000);
  if (!deps.sessionExists(todo.tmuxSessionId)) {
    const detail = lastExecError ? `: ${lastExecError}` : "";
    debugLog("recovery", "fresh-fail", { todoId: todo.id, error: lastExecError });
    deps.log(
      `${new Date().toISOString()} todo=${todo.id} branch=B result=failed${detail}`
    );
    throw new Error(`failed to recover tmux session for todo ${todo.id}${detail}`);
  }

  const pane = deps.capturePane(todo.tmuxSessionId);
  const url = parseRemoteControlUrl(pane);
  const patch: Partial<TodoItem> = { firstMessageSent: false };
  if (url) patch.remoteControlUrl = url;
  deps.updateTodo(todo.id, patch);

  debugLog("recovery", "fresh-ok", { todoId: todo.id, urlCaptured: !!url });
  deps.log(`${new Date().toISOString()} todo=${todo.id} branch=B result=ok`);
}
```

**不改** `createDefaultDeps` — 既有 `recovery.log` 路径与行为完全保留。

- [ ] **Step 2: 运行既有测试**

Run: `npm test -- tests/services/recovery.test.ts`
Expected: PASS（埋点叠加，不改分支决策）。

- [ ] **Step 3: commit**

```bash
git add src/services/recovery.ts
git commit -m "feat(recovery): mirror branch decisions to debug log (recovery.log unchanged)"
```

---

## Task 8: 接入 `services/polling.ts`

**Files:**
- Modify: `src/services/polling.ts`

- [ ] **Step 1: 改 polling.ts**

Edit `src/services/polling.ts`。文件头新增 import（紧跟第 6 行 `import { ensureSessionAlive... }` 之后）：

```ts
import { debugLog } from "../utils/debug-log.js";
```

在 `runPolling` 函数里（原 145 行起），把 `state = initialState(...)` 那行之后的 `log("info", "polling started: ...")` 调用行（原 150 行）**之后**追加：

```ts
  debugLog("polling", "start", {
    cwd,
    intervalMinutes,
    queue: state.queue,
  });
```

改 `execute` 函数体（原 156-199 行）为：

```ts
  const execute = (): void => {
    const todos = store.list();
    debugLog("polling", "tick-begin", {
      focusIndex: state.focusIndex,
      queueLen: state.queue.length,
    });
    const { newState, actions } = tick(state, todos, defaultSessionExists);
    state = newState;
    debugLog("polling", "tick-decision", {
      actions: actions.map((a) => a.type),
    });

    for (const action of actions) {
      switch (action.type) {
        case "wait":
          break;

        case "skip":
          debugLog("polling", "skip", { id: action.id, reason: action.reason });
          log("warn", `skip ${action.id}: ${action.reason}`);
          break;

        case "trigger": {
          const todo = store.get(action.id);
          if (!todo) {
            log("warn", `trigger skipped: todo ${action.id} not found`);
            break;
          }
          debugLog("polling", "trigger", {
            id: action.id,
            tmuxSessionId: action.tmuxSessionId,
            title: action.title,
          });
          try {
            ensureSessionAlive(cwd, todo, createDefaultDeps(cwd));
          } catch (e) {
            log("error", `recovery failed for ${action.id}: ${(e as Error).message}`);
            break;
          }
          const cmd = buildSendKeysCommand(todo.tmuxSessionId, message);
          const start = Date.now();
          try {
            execSync(cmd);
            debugLog("polling", "send-keys-ok", {
              id: action.id,
              durationMs: Date.now() - start,
            });
            log("info", `triggered ${action.id} (${action.title})`);
          } catch (e) {
            debugLog("polling", "send-keys-fail", {
              id: action.id,
              error: (e as Error).message,
            });
            log("error", `send-keys failed for ${action.id}: ${(e as Error).message}`);
          }
          break;
        }

        case "terminate":
          debugLog("polling", "terminate", { reason: action.reason });
          log("info", `terminate: ${action.reason}`);
          cron?.stop();
          process.exit(0);
      }
    }
  };
```

- [ ] **Step 2: 运行既有测试**

Run: `npm test -- tests/services/polling.test.ts`
Expected: PASS（`tick` 纯函数未改；`runPolling` 的新增 debugLog 不影响断言）。

- [ ] **Step 3: commit**

```bash
git add src/services/polling.ts
git commit -m "feat(polling): emit debug logs for start/tick/trigger/skip/terminate"
```

---

## Task 9: 接入 `services/scheduler.ts`

**Files:**
- Modify: `src/services/scheduler.ts`

- [ ] **Step 1: 改 scheduler.ts**

Edit `src/services/scheduler.ts`。文件头新增 import（紧跟第 5 行 `import type { ScheduleItem... }` 之后）：

```ts
import { debugLog } from "../utils/debug-log.js";
```

在 `runScheduler` 函数里：

找到 `log("info", \`scheduler started: ${valid.length} schedules loaded\`);`（原 139 行）**之前**插入：

```ts
  debugLog("scheduler", "start", { count: valid.length });
```

找到 `for (const s of valid)` 输出详情的循环（原 140-143 行），在 `log("info", ...)` **之前**插入 `debugLog`。把循环改为：

```ts
  for (const s of valid) {
    const detail = s.type === "skill" ? `skill: ${s.skill}` : `command: ${s.command}`;
    debugLog("scheduler", "schedule-loaded", {
      name: s.name,
      cron: s.cron,
      type: s.type,
      detail,
    });
    log("info", `  [${s.name}] cron="${s.cron}" (${detail})`);
  }
```

改主 cron 循环（原 147-161 行）为：

```ts
  for (const item of valid) {
    const job = new Cron(item.cron, () => {
      const detail = item.type === "skill" ? `skill: ${item.skill}` : `command: ${item.command}`;
      debugLog("scheduler", "fire", { name: item.name });
      log("info", `[${item.name}] triggered (${detail})`);

      const result = executeSchedule(item, cwd);

      if (result.ok) {
        debugLog("scheduler", "fire-ok", {
          name: item.name,
          durationMs: result.durationMs ?? 0,
        });
        log("info", `[${item.name}] completed (${result.durationMs}ms)`);
      } else {
        debugLog("scheduler", "fire-fail", {
          name: item.name,
          durationMs: result.durationMs ?? 0,
          error: result.error ?? "",
        });
        log("error", `[${item.name}] failed: ${result.error}`);
      }
    });
    crons.push(job);
  }
```

- [ ] **Step 2: 运行既有测试**

Run: `npm test -- tests/services/scheduler.test.ts`
Expected: PASS。

- [ ] **Step 3: commit**

```bash
git add src/services/scheduler.ts
git commit -m "feat(scheduler): emit debug logs for start/schedule-loaded/fire/ok/fail"
```

---

## Task 10: 全量回归

- [ ] **Step 1: 运行全部测试**

Run: `npm test`
Expected: 所有 case PASS（包括新增的 debug-log 和 store-debug）。

- [ ] **Step 2: 运行 TypeScript 编译检查**

Run: `npm run build`
Expected: 编译通过，`dist/` 下产物完整。

- [ ] **Step 3: 手工验证（可选）**

```bash
# 从任意目录启动一个临时 .harness：
mkdir -p /tmp/harness-verify/.harness
cd /tmp/harness-verify
echo '{"debug":true}' > .harness/config.json

# 用 tsx 跑一个简单 store 操作，确认 debug.log 被写：
npx tsx -e 'import("<repo>/src/store.js").then(m => { const s = new m.TodoStore("."); s.add({id:"x",title:"t",description:"d",status:"pending",tmuxSessionId:"",remoteControlUrl:"",claudeSessionId:"",claudeSessionName:"",firstMessageSent:false}); })'

cat .harness/debug.log
# 期望：看到一行 [...] [store] add id=x title=t status=pending
```

此步骤失败不阻断——主验证来自单元测试；此处只是增信。

---

## Task 11: 更新 README 与版本号

**Files:**
- Modify: `README.md`
- Modify: `package.json:3`

- [ ] **Step 1: 改 README**

Edit `README.md`。在 `### Payload 示例` 那节结束后（约 138 行之后、`## Data` 之前）追加下面一整段（直接粘贴，含 Markdown 标记）：

~~~
### Debug 日志

在 `.harness/config.json` 中设置 `"debug": true`，即可在 `.harness/debug.log`
追加记录 hooks、polling、scheduler、recovery、tmux、store、notice、session-log
各模块的结构化日志，便于排查问题。关闭时零 I/O 开销。修改 config 后需重启
polling / scheduler 进程生效。日志无自动轮转，需自行 `rm` 清理。
~~~

即写入 README 的是一个 `###` 子标题 + 一段文字。README 在 `### 配置文件` 处已经展示了完整的 `config.json` 示例，这里无需再贴 JSON。

- [ ] **Step 2: 运行 version:bump 脚本**

Run: `npm run version:bump`
Expected: `package.json` 的 `version` 从 `"0.1.27"` 变为 `"0.1.28"`，并且 `scripts/sync-version.mjs` 同步任何依赖的版本号位置。

- [ ] **Step 3: 确认全部测试仍通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 4: commit**

```bash
git add README.md package.json package-lock.json
git commit -m "docs+chore: document debug switch and bump to 0.1.28"
```

---

## Self-Review

已完成；以下为自检记录，无需读者执行。

**1. Spec coverage 检查：**

| Spec 要求 | 对应任务 |
|---|---|
| 新 helper `debugLog(module, event, kv?)` | Task 1 |
| 进程内缓存 `.harness/config.json` | Task 1 (`resolve` 中 `cached` 变量) |
| `debug` 缺省 false + 严格布尔 | Task 1 测试 `disabled when debug=false` / `disabled when debug is truthy but not strictly true` |
| 配置不存在 / 解析失败 视为 off | Task 1 测试 `disabled when config missing` |
| 行格式 `[ts] [module] event k=v` | Task 1 测试 `enabled when debug=true writes one line` |
| `formatKv` 6 条规则 | Task 1 的 kv: 系列测试 |
| `appendFileSync` 失败静默 | Task 1 测试 `survives appendFileSync throwing` |
| mkdir recursive | Task 1 测试 `creates .harness/ directory if missing` |
| hooks 埋点（event-dispatch / hook-exec / ok / fail） | Task 3 |
| polling 埋点（start / tick-begin / tick-decision / trigger / skip / send-keys-ok/fail / terminate） | Task 8 |
| scheduler 埋点（start / schedule-loaded / fire / fire-ok/fail） | Task 9 |
| recovery 埋点（enter / resume-try/ok/fail / fresh-try/ok/fail） | Task 7 |
| tmux 埋点（exec / exec-ok/fail） | Task 4 |
| store 埋点（add / update / delete） | Task 2 |
| notice 埋点（send） | Task 5 |
| session-log 埋点（lookup / parse-ok） | Task 6 |
| store-debug 冒烟测试 | Task 2 |
| recovery.log 原路径不动 | Task 7（`createDefaultDeps` 不改） |
| 不改既有 console 输出 | 各任务都保留原 `log()` / `console.log` |
| README 更新 | Task 11 |
| 版本号 0.1.28 | Task 11 |

覆盖完整。

**2. Placeholder scan：** 无 TBD / TODO / "similar to" / "add appropriate X"。每处代码块都是完整可 paste 的内容。

**3. Type consistency：**
- `debugLog(module: string, event: string, kv?: Record<string, unknown>): void` — Task 1 定义；其余任务调用形式一致
- `_resetDebugCache(): void` — Task 1 / Task 2 测试使用
- `buildSendKeysCommand` / `ensureSessionAlive` / `createDefaultDeps` — 沿用既有签名
- Task 9 的 `result.durationMs ?? 0` 是对 `ExecuteResult.durationMs?: number` 的安全读取，与 `src/services/scheduler.ts:67-71` 的类型一致

类型一致，无冲突。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-23-harness-debug-log.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
