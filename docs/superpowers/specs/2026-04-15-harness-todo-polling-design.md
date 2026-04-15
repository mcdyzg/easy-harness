# Harness Todo Polling 设计

## 目标

新增 skill `harness-todo-polling`，用 cron 驱动的后台轮询把"当前处于 `running` 状态的待办"**串行**起来：每次只盯一个焦点待办，焦点一转 `pending`（Claude 本轮收尾、会话空闲），就自动把用户指定的 trigger 文本通过 `tmux send-keys` 投给"下一个"待办，把它重新激活。轮询过程中整张表完全无 `running` 时自动终止。

## 背景

项目现有状态流转：

- `harness-todo-create`：记录初始化为 `running`，tmux + Claude 会话起来
- `harness-session-send-user-message`：发消息时把状态强制置回 `running`
- `scripts/on-stop.sh`（Stop hook）：Claude 每完成一轮把 `running` 回落成 `pending`
- `harness-todo-finish` / `harness-todo-remove`：最终态

因此，`pending` 的语义就是"Claude 会话在线但空闲、等人投喂下一步指令"。用户手里可能同时有 N 条待办都是 `running`（并发启动）或陆续回落到 `pending`，这个 skill 把"谁当前应该被推进"串起来，避免并发占用注意力。

参考同目录下 `2026-04-13-stop-hook-notification-design.md` 的"后台 tmux 派发独立进程"架构和 `scripts/on-stop.sh` 的实现风格。

## 概念：串行焦点调度

- **焦点（focus）**：当前被轮询盯着的一个待办 id
- **queue**：焦点候选队列，启动时以"当前所有 running 待办"按 todos.json 数组顺序初始化；运行中可以动态追加新出现的 running
- **seen**：已处理过的 id 集合，兼管"已 trigger 过"与"已跳过（tmux 会话丢失）"，保证动态追加时不会再把这些 id 捡回来
- **trigger**：用户启动 skill 时一次性提供的文本，对所有"下一个"复用

状态流转：焦点仍 `running` → 继续等；焦点转 `pending` / `done` / `failed` / 记录被删 → 推进到下一个焦点。

## 架构

```
┌─────────────────────────────────────────────────────┐
│ 用户: /harness-todo-polling 继续下一步              │
└─────────────────────────────────────────────────────┘
                 ↓ skill body 主导
                 ↓ 1. 校验 .harness/todos.json 有 ≥1 running
                 ↓ 2. 生成 polling 会话名
                 ↓ 3. tmux new-session -d 启动后台
                 ↓ 4. 回显会话名后立即结束
                 ↓
┌─────────────────────────────────────────────────────┐
│ tmux session: polling-<ts>                          │
│ ┌─────────────────────────────────────────────────┐ │
│ │ npx tsx <pluginRoot>/src/scripts/polling.ts     │ │
│ │   --cwd ... --message ... [--interval 60]       │ │
│ │                                                 │ │
│ │   tick0 (立即):                                  │ │
│ │     - 读 todos.json                             │ │
│ │     - 初始化 queue = 当前 running id            │ │
│ │     - focusIndex = 0                            │ │
│ │     - send-keys queue[0] <message>              │ │
│ │                                                 │ │
│ │   cron(每 interval 秒) tickN:                    │ │
│ │     - 读 todos.json                             │ │
│ │     - 终止判定 / 焦点检查 / 推进 / send-keys    │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
                 ↓ send-keys 投递到
┌─────────────────────────────────────────────────────┐
│ tmux session: harness-<todoId>                      │
│   Claude 主会话收到"继续下一步" → 恢复工作         │
└─────────────────────────────────────────────────────┘
```

`polling-<ts>` tmux 会话名故意不以 `harness-` 开头，避开 `on-stop.sh` 的递归触发（该 hook 只对 `harness-*` 生效）。

## 组件分工

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| Skill 正文 | `skills/harness-todo-polling/SKILL.md`（新建） | 教 Claude 解析入参、校验 running 数量、起后台 tmux、回显结果 |
| 轮询脚本 | `src/scripts/polling.ts`（新建） | cron tick 主逻辑：读 todos → 判焦点 → send-keys → 终止 |
| tmux helper | `src/services/tmux.ts`（复用） | `buildSendKeysCommand` 已有，沿用 |
| 依赖 | `croner`（新增到 `package.json` 的 `dependencies`） | cron 调度器，零依赖、ESM 原生、TS-first |

## Skill 入参

- **message**（必填，位置参数）：整段 skill args 文本直接当 trigger 消息，不做额外解析
  - 例：`/harness-todo-polling 继续下一步` → message = `"继续下一步"`
- **interval**（可选，`--interval <n>`）：轮询间隔分钟数，整数，默认 1（= 每分钟一次）
  - 取值范围 ≥ 1；< 1 直接拒绝。粒度故意锁在分钟，对齐 `croner` 的 5 字段 cron 表达式 `*/<n> * * * *`

> 只有 `--interval` 是显式选项；其余文本整段归入 message。若用户既想指定 interval 又想用 `--` 字符开头的消息，需自己把消息放在 `--interval` 后。

## Skill 启动流程（SKILL.md 主导）

1. **取 args 文本**：把用户完整输入作为 raw 字符串，按空格切分出第一个 `--interval <n>`（若存在），剩余部分拼回当作 `message`。`message` 为空 → 直接告知用户并退出
2. **校验前置**：用 `TodoStore` 列出 todos.json，统计 `status === 'running'` 的条数。为 0 → 告知"暂无 running 待办，无需轮询"，结束
3. **生成会话名**：`polling-$(date +%s)`
4. **启动后台 tmux**：
   ```bash
   tmux new-session -d -s "polling-<ts>" -c "<cwd>" \
     "npx --yes tsx '<pluginRoot>/src/scripts/polling.ts' \
        --cwd '<cwd>' --interval <minutes> --message '<escaped message>'"
   ```
5. **回显**：告诉用户 polling 会话名 + 两条自助操作提示（`tmux attach -t <name>` 看日志、`tmux kill-session -t <name>` 终止）并结束当前 turn

## 轮询脚本 `polling.ts`

### CLI 约定

```
npx tsx polling.ts --cwd <cwd> --message <text> [--interval <minutes>]
```

- `--cwd` 必填：用于定位 `.harness/todos.json`
- `--message` 必填
- `--interval` 可选，正整数分钟数，默认 1；进程内翻成 croner 的 `*/<n> * * * *`

### 进程内状态（不落盘）

```ts
interface PollingState {
  queue: string[];        // 焦点候选队列，按顺序
  focusIndex: number;     // 当前焦点在 queue 中的下标
  seen: Set<string>;      // 已 trigger 或已跳过（死会话）的 id
}
```

### tick0（进程启动立刻执行一次，不等 cron 第一拍）

1. 读 `todos.json`
2. 遍历取 `status === 'running'` 的 id，按数组顺序填入 `queue`
3. `queue` 为空 → 打日志 `no running todos at startup` 并 `process.exit(0)`
4. `focusIndex = -1`（刻意设为 -1，下一步调用 `advance()` 就会自增到 0 并做完整校验）
5. 调用 `advance()`。它会：把 focusIndex 推到 0、校验 `queue[0]` 的记录与 tmux 会话有效性；失败则继续推进 / 扩队 / 乃至直接终止；成功则 `triggerTodo(queue[0])`

这样 tick0 和后续 tick 共用同一套校验逻辑，不会在 queue[0] 的 tmux 会话已丢失时直接崩溃。

### cron 每拍 `tickN`

1. 读 `todos.json`，构造 `id → todo` 映射
2. **终止判定**：如果整个 todos.json 没有任何 `status === 'running'` → `cron.stop()`，`process.exit(0)`
3. 取 `current = map[queue[focusIndex]]`
4. 若 `current` 存在且 `status === 'running'` → 本拍无事，`return`
5. 否则进入"推进循环"（见下文）

### 推进循环 `advance()`

```
loop:
  focusIndex++

  if focusIndex >= queue.length:
    newIds = [t.id for t in running(todos)
              if t.id not in queue and t.id not in seen]
    queue.push(...newIds)
    if focusIndex >= queue.length:
      日志 "queue exhausted, terminating"
      cron.stop(); process.exit(0)

  nextId = queue[focusIndex]
  nextTodo = map[nextId]

  if nextTodo is undefined:
    seen.add(nextId)
    日志 "skip <nextId>: record removed"
    continue

  if nextTodo.tmuxSessionId is empty
     or `tmux has-session -t <id>` 非零退出:
    seen.add(nextId)
    日志 "skip <nextId>: tmux session missing"
    continue

  triggerTodo(nextId)   // send-keys + seen.add
  break
```

"跳过"即"推进 focusIndex 到下一个 + 加入 seen"：队列内的这一项再也不会被重新当作焦点（focusIndex 不回退），动态扩队时 seen 过滤也阻止它被追回来，事实上等同于"从队列中移除"。

### `triggerTodo(id)`

```ts
function triggerTodo(id: string): void {
  const todo = store.get(id);
  // 前置有效性已在调用方校验，这里直接发
  execSync(buildSendKeysCommand(todo.tmuxSessionId, message));
  seen.add(id);
  console.log(`[${new Date().toISOString()}] triggered ${id} (${todo.title})`);
}
```

消息转义沿用 `src/services/tmux.ts:buildSendKeysCommand` 里已有的单引号 `'\''` 套路，不再重复实现。

### 终止判定汇总（任一触发即退出进程）

- 进程启动时 running 为空
- 某次 tick 读到整表无 running
- 推进循环里 `focusIndex` 越界且无新增 running 可补

终止都走 `cron.stop()` + `process.exit(0)`；最终 tmux 会话里的进程退出，`tmux new-session -d` 创建的那个 session 因内部命令退出而自动消失，无需外部 kill。

### 信号处理

- `SIGINT` / `SIGTERM` → `cron.stop()`，打一行日志后 `process.exit(0)`

这样用户 `tmux kill-session -t polling-<ts>` 或 Ctrl-C（如果 attach 着）都能优雅收尾。

### 日志

直接 `console.log` / `console.error`，由 tmux 会话的 pane 承接；用户 `tmux attach -t polling-<ts>` 就能看到历史。格式固定 `[ISO timestamp] <level> <msg>`。

无额外日志落盘；若需要归档，用户自己 `tmux pipe-pane` 即可。

## 边界与不变量

- **并发多个 polling 会话**：允许。会话名带时间戳，互不冲突。每个 polling 都独立持有自己的 queue/seen
- **待办被 `finish` / `remove`**：tick 读不到记录 → 按"推进"逻辑自然跳过
- **tmux 会话丢失（机器重启等）**：`tmux has-session` 非零 → 跳过并从队列移除，不做恢复（恢复责任归 `harness-session-send-user-message`）
- **queue 里全部消化完但整表仍有 running**：说明这些 running 是 polling 启动之后新增的、且 seen 已经标记过（理论上不会）或者是别的 polling 管辖的——不是本次 polling 的职责范围，走"推进循环无新候选 → 终止"
- **focus 本拍从 `running` → `running`（假轮询）**：不会发生；`running` 只由 `send-keys` / `harness-session-send-user-message` 主动置位，且 `on-stop.sh` 会立刻把它刷回 `pending`

## 文件清单

新增：

- `skills/harness-todo-polling/SKILL.md`
- `src/scripts/polling.ts`

修改：

- `package.json`：在 `dependencies` 加 `croner`（最新稳定版）
- `README.md`：在 Skills 列表里加一行 `/harness-todo-polling` 简介

无需修改：

- `src/store.ts` / `src/types.ts` / `src/services/tmux.ts`：既有能力足够
- `hooks/hooks.json`：polling 会话名不以 `harness-` 开头，不受现有 Stop hook 影响

## 测试要点

- **单元测试**（`tests/polling.*.test.ts`）：
  - 把 `polling.ts` 的核心 tick 逻辑抽到可独立测的纯函数（入参：当前状态 + todos 快照；出参：下一步动作枚举），对 `advance` / 终止分支单独断言
  - 用 `vitest` 的 `vi.useFakeTimers()` 覆盖 cron 调度：初始化 → 假时间步进一拍 → 断言发出的 send-keys 目标
- **集成测试**：可跳过（涉及真 tmux），但至少手动跑一次"两个 running 待办 + 触发 pending" 的脚本验证
