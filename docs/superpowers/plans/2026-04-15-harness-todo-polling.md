# Harness Todo Polling 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `harness-todo-polling` skill，用 cron 驱动的后台 tmux 会话串行调度 `running` 待办：焦点转 `pending` 就 `tmux send-keys` 给下一个，整表无 running 自终止。

**Architecture:** Skill 正文负责启动后台 tmux；`src/scripts/polling.ts` 是 CLI 入口，`src/services/polling.ts` 拆成"纯决策函数 `tick()`" 和"副作用 runner `runPolling()`"，核心逻辑通过依赖注入 `sessionExists` / `sendKeys` / `now` 保证可测。croner 负责 `*/N * * * *` 定时触发。

**Tech Stack:** TypeScript (ESM, Node ≥ 18), vitest, `croner ^8.0.0`（新增依赖），node:util `parseArgs`，tmux CLI，`npx tsx` 运行 TS 源文件。

**Spec:** `docs/superpowers/specs/2026-04-15-harness-todo-polling-design.md`

> **Implementation note —— 关于"测试"：** 跟项目既有约定一致，`src/services/polling.ts` 里的纯函数（`initialState`、`tick`）走 vitest TDD；副作用 runner（`runPolling`）、CLI 入口、SKILL.md、README 改动走**验证驱动**（跑命令观察输出）。不要勉强给 croner 调度和 execSync tmux 调用写单测——那不是"测试"，是"抄实现"。

---

## 文件结构

**新增：**

- `skills/harness-todo-polling/SKILL.md` —— skill 正文，教 Claude 校验 running、启动后台 tmux、回显会话名
- `src/services/polling.ts` —— 类型 + 纯决策函数 `tick` + 副作用 runner `runPolling`
- `src/scripts/polling.ts` —— CLI 入口，解析 argv 后调用 `runPolling`
- `tests/services/polling.test.ts` —— 纯函数单测

**修改：**

- `package.json` —— 新增 `dependencies`: `croner ^8.0.0`
- `README.md` —— Skills 列表里加一行 `/harness-todo-polling`

**不改：** `src/store.ts`、`src/types.ts`、`src/services/tmux.ts`、`hooks/hooks.json`、`.claude-plugin/plugin.json`。既有能力齐全，且 polling 会话名不以 `harness-` 开头，天然规避 Stop hook 递归。

---

## Task 1: 引入 croner 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 croner**

```bash
npm install croner@^8.0.0
```

Expected: `package.json` 的 `dependencies` 新增 `"croner": "^8.0.0"`（或 npm 自动锁定的 `^8.x.y`），`package-lock.json` 更新。

- [ ] **Step 2: 验证能被 tsx 导入**

Run:
```bash
npx --yes tsx -e "import { Cron } from 'croner'; console.log(typeof Cron);"
```
Expected: 输出 `function`。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add croner dependency for harness-todo-polling"
```

---

## Task 2: 定义 polling 类型与 `initialState`（TDD）

**Files:**
- Create: `src/services/polling.ts`
- Create: `tests/services/polling.test.ts`

- [ ] **Step 1: 先写 `initialState` 的失败测试**

新建 `tests/services/polling.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { initialState } from "../../src/services/polling.js";
import type { TodoItem } from "../../src/types.js";

const todo = (id: string, status: TodoItem["status"], tmuxSessionId = `harness-${id}`): TodoItem => ({
  id,
  title: `todo-${id}`,
  description: "",
  status,
  tmuxSessionId,
  remoteControlUrl: "",
  claudeSessionId: "",
  claudeSessionName: "",
});

describe("initialState", () => {
  it("按 todos.json 数组顺序把 running 待办收进 queue", () => {
    const todos = [
      todo("a", "pending"),
      todo("b", "running"),
      todo("c", "done"),
      todo("d", "running"),
    ];
    const s = initialState(todos);
    expect(s.queue).toEqual(["b", "d"]);
    expect(s.focusIndex).toBe(-1);
    expect(Array.from(s.seen)).toEqual([]);
  });

  it("没有 running 时 queue 为空", () => {
    const todos = [todo("a", "pending"), todo("b", "done")];
    const s = initialState(todos);
    expect(s.queue).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/services/polling.test.ts`
Expected: FAIL，提示 `Cannot find module '../../src/services/polling'` 或类似。

- [ ] **Step 3: 实现 `initialState` + 类型**

新建 `src/services/polling.ts`：

```ts
import type { TodoItem } from "../types.js";

/** polling 进程内的运行时状态。纯数据，`tick` 不会在原对象上写入 */
export interface PollingState {
  /** 焦点候选队列，按插入顺序 */
  queue: string[];
  /** 当前焦点在 queue 中的下标；-1 代表尚未开始（tick0 前） */
  focusIndex: number;
  /** 已 trigger 或已跳过（死会话 / 记录消失）的 id；动态扩队时用它过滤 */
  seen: Set<string>;
}

/** 初始化状态：队列 = 当前所有 running 待办的 id，按 todos 原数组顺序 */
export function initialState(todos: TodoItem[]): PollingState {
  return {
    queue: todos.filter((t) => t.status === "running").map((t) => t.id),
    focusIndex: -1,
    seen: new Set(),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/services/polling.test.ts`
Expected: 2 tests passing。

- [ ] **Step 5: Commit**

```bash
git add src/services/polling.ts tests/services/polling.test.ts
git commit -m "feat: add polling state types and initialState helper"
```

---

## Task 3: 实现纯决策函数 `tick`（TDD）

`tick` 是整个 polling 的大脑：接受当前状态 + todos 快照 + `sessionExists` 谓词，返回下一个新状态 + 一串 action。runner 只负责按顺序执行这些 action。

**Files:**
- Modify: `src/services/polling.ts`
- Modify: `tests/services/polling.test.ts`

- [ ] **Step 1: 为 `tick` 写失败测试**

在 `tests/services/polling.test.ts` 追加：

```ts
import { tick } from "../../src/services/polling.js";

const liveSession = () => true;
const deadSession = () => false;

describe("tick —— 终止条件", () => {
  it("整表无 running 时返回 terminate", () => {
    const state = { queue: ["a"], focusIndex: 0, seen: new Set(["a"]) };
    const todos = [todo("a", "pending"), todo("b", "done")];
    const { actions, newState } = tick(state, todos, liveSession);
    expect(actions).toEqual([{ type: "terminate", reason: "no running todos" }]);
    expect(newState).toEqual(state);
  });
});

describe("tick —— 焦点仍 running", () => {
  it("返回 wait，状态不变", () => {
    const state = { queue: ["a"], focusIndex: 0, seen: new Set(["a"]) };
    const todos = [todo("a", "running")];
    const { actions, newState } = tick(state, todos, liveSession);
    expect(actions).toEqual([{ type: "wait" }]);
    expect(newState).toEqual(state);
  });
});

describe("tick —— 推进（tick0 语义：focusIndex=-1）", () => {
  it("从 -1 推到 0，trigger queue[0]", () => {
    const state = { queue: ["a", "b"], focusIndex: -1, seen: new Set<string>() };
    const todos = [todo("a", "running"), todo("b", "running")];
    const { actions, newState } = tick(state, todos, liveSession);
    expect(actions).toEqual([
      { type: "trigger", id: "a", tmuxSessionId: "harness-a", title: "todo-a" },
    ]);
    expect(newState.focusIndex).toBe(0);
    expect(Array.from(newState.seen)).toEqual(["a"]);
  });
});

describe("tick —— 推进（焦点已 pending）", () => {
  it("跳到下一个 running 并 trigger", () => {
    const state = { queue: ["a", "b"], focusIndex: 0, seen: new Set(["a"]) };
    const todos = [todo("a", "pending"), todo("b", "running")];
    const { actions, newState } = tick(state, todos, liveSession);
    expect(actions).toEqual([
      { type: "trigger", id: "b", tmuxSessionId: "harness-b", title: "todo-b" },
    ]);
    expect(newState.focusIndex).toBe(1);
    expect(Array.from(newState.seen).sort()).toEqual(["a", "b"]);
  });

  it("跳过 tmux 会话已丢失的待办，继续推进", () => {
    const state = { queue: ["a", "b", "c"], focusIndex: 0, seen: new Set(["a"]) };
    const todos = [
      todo("a", "pending"),
      todo("b", "running", "harness-b"),
      todo("c", "running", "harness-c"),
    ];
    // b 会话死了，c 会话活着
    const exists = (id: string) => id === "harness-c";
    const { actions, newState } = tick(state, todos, exists);
    expect(actions).toEqual([
      { type: "skip", id: "b", reason: "tmux session missing" },
      { type: "trigger", id: "c", tmuxSessionId: "harness-c", title: "todo-c" },
    ]);
    expect(newState.focusIndex).toBe(2);
    expect(Array.from(newState.seen).sort()).toEqual(["a", "b", "c"]);
  });

  it("跳过 tmuxSessionId 为空字符串的待办", () => {
    const state = { queue: ["a", "b"], focusIndex: -1, seen: new Set<string>() };
    const todos = [todo("a", "running", ""), todo("b", "running", "harness-b")];
    const { actions, newState } = tick(state, todos, liveSession);
    expect(actions).toEqual([
      { type: "skip", id: "a", reason: "tmuxSessionId empty" },
      { type: "trigger", id: "b", tmuxSessionId: "harness-b", title: "todo-b" },
    ]);
    expect(newState.focusIndex).toBe(1);
  });

  it("跳过 todos.json 里已不存在的记录", () => {
    const state = { queue: ["a", "b"], focusIndex: 0, seen: new Set(["a"]) };
    const todos = [todo("a", "pending"), /* b 被删 */ todo("c", "running")];
    const { actions, newState } = tick(state, todos, liveSession);
    // b 被删 → skip；c 不在 queue，按动态扩队逻辑追加
    expect(actions).toEqual([
      { type: "skip", id: "b", reason: "record removed" },
      { type: "trigger", id: "c", tmuxSessionId: "harness-c", title: "todo-c" },
    ]);
    expect(newState.queue).toEqual(["a", "b", "c"]);
    expect(newState.focusIndex).toBe(2);
  });
});

describe("tick —— 队列耗尽的动态扩队", () => {
  it("queue 用完但 todos 里还有未见过的 running，追加后继续", () => {
    const state = { queue: ["a"], focusIndex: 0, seen: new Set(["a"]) };
    const todos = [todo("a", "pending"), todo("b", "running")];
    const { actions, newState } = tick(state, todos, liveSession);
    expect(actions).toEqual([
      { type: "trigger", id: "b", tmuxSessionId: "harness-b", title: "todo-b" },
    ]);
    expect(newState.queue).toEqual(["a", "b"]);
    expect(newState.focusIndex).toBe(1);
  });

  it("queue 用完且无新 running 可补 → terminate", () => {
    const state = { queue: ["a"], focusIndex: 0, seen: new Set(["a"]) };
    const todos = [
      todo("a", "pending"),
      todo("b", "running"), // 但 b 在 seen 里
    ];
    const stateWithSeenB = {
      queue: ["a"],
      focusIndex: 0,
      seen: new Set(["a", "b"]),
    };
    const { actions, newState } = tick(stateWithSeenB, todos, liveSession);
    expect(actions).toEqual([
      { type: "terminate", reason: "queue exhausted" },
    ]);
    expect(newState).toEqual(stateWithSeenB);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/services/polling.test.ts`
Expected: 上面所有新 case 失败（`tick is not a function` 或类似）。

- [ ] **Step 3: 实现 `tick`**

在 `src/services/polling.ts` 追加：

```ts
export type Action =
  | { type: "wait" }
  | { type: "terminate"; reason: string }
  | { type: "trigger"; id: string; tmuxSessionId: string; title: string }
  | { type: "skip"; id: string; reason: string };

/**
 * 纯函数：基于当前状态与 todos 快照决定下一步。
 * 不修改传入的 state / seen；返回新 state + 动作序列，交给 runner 执行。
 *
 * sessionExists(sessionId): 用于判断 tmux 会话是否存在；注入以保证纯测试。
 */
export function tick(
  state: PollingState,
  todos: TodoItem[],
  sessionExists: (sessionId: string) => boolean
): { newState: PollingState; actions: Action[] } {
  // 1. 终止判定：全表无 running
  const anyRunning = todos.some((t) => t.status === "running");
  if (!anyRunning) {
    return {
      newState: state,
      actions: [{ type: "terminate", reason: "no running todos" }],
    };
  }

  const map = new Map(todos.map((t) => [t.id, t]));

  // 2. 焦点仍 running → wait
  const current = state.focusIndex >= 0 ? map.get(state.queue[state.focusIndex]) : undefined;
  if (current && current.status === "running") {
    return { newState: state, actions: [{ type: "wait" }] };
  }

  // 3. 进入推进循环：复制一份可变状态
  const queue = [...state.queue];
  const seen = new Set(state.seen);
  let focusIndex = state.focusIndex;
  const actions: Action[] = [];

  while (true) {
    focusIndex++;

    // 3a. 越界：尝试动态扩队
    if (focusIndex >= queue.length) {
      const newIds = todos
        .filter((t) => t.status === "running" && !queue.includes(t.id) && !seen.has(t.id))
        .map((t) => t.id);
      queue.push(...newIds);
      if (focusIndex >= queue.length) {
        actions.push({ type: "terminate", reason: "queue exhausted" });
        return {
          newState: { queue, focusIndex: state.focusIndex, seen },
          actions,
        };
      }
    }

    const nextId = queue[focusIndex];
    const nextTodo = map.get(nextId);

    // 3b. 记录已被删
    if (!nextTodo) {
      actions.push({ type: "skip", id: nextId, reason: "record removed" });
      seen.add(nextId);
      continue;
    }

    // 3c. tmuxSessionId 为空
    if (nextTodo.tmuxSessionId === "") {
      actions.push({ type: "skip", id: nextId, reason: "tmuxSessionId empty" });
      seen.add(nextId);
      continue;
    }

    // 3d. tmux 会话已丢失
    if (!sessionExists(nextTodo.tmuxSessionId)) {
      actions.push({ type: "skip", id: nextId, reason: "tmux session missing" });
      seen.add(nextId);
      continue;
    }

    // 3e. 命中有效候选，发 trigger
    actions.push({
      type: "trigger",
      id: nextId,
      tmuxSessionId: nextTodo.tmuxSessionId,
      title: nextTodo.title,
    });
    seen.add(nextId);
    return { newState: { queue, focusIndex, seen }, actions };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/services/polling.test.ts`
Expected: 所有 case 全绿（至少 10 个 test）。

- [ ] **Step 5: Commit**

```bash
git add src/services/polling.ts tests/services/polling.test.ts
git commit -m "feat: add pure tick decision function for polling"
```

---

## Task 4: 实现 `runPolling` 副作用 runner

**Files:**
- Modify: `src/services/polling.ts`

Runner 的职责：拿 cwd / message / intervalMinutes，串起「读 todos → 调 tick → 执行 actions」的副作用。

- [ ] **Step 1: 在 `src/services/polling.ts` 追加 runner**

```ts
import { execSync } from "node:child_process";
import { Cron } from "croner";
import { TodoStore } from "../store.js";
import { buildSendKeysCommand } from "./tmux.js";

export interface RunPollingOptions {
  cwd: string;
  message: string;
  intervalMinutes: number;
}

/**
 * 判断 tmux 会话是否还在。`tmux has-session` 退出码 0 = 存在。
 * 任何异常（tmux 不在 PATH、会话名字为空、stderr 非空）都视为"不存在"。
 */
function defaultSessionExists(sessionId: string): boolean {
  if (!sessionId) return false;
  try {
    execSync(`tmux has-session -t ${JSON.stringify(sessionId)} 2>/dev/null`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function log(level: "info" | "warn" | "error", msg: string): void {
  const line = `[${new Date().toISOString()}] ${level} ${msg}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

/**
 * 启动 polling 循环。阻塞：本函数调用 Cron.schedule 并注册 SIGINT/SIGTERM 处理器，
 * 真正退出由 tick 返回 terminate 时触发 `process.exit(0)`。
 */
export function runPolling(opts: RunPollingOptions): void {
  const { cwd, message, intervalMinutes } = opts;
  const store = new TodoStore(cwd);

  let state = initialState(store.list());
  log("info", `polling started: cwd=${cwd} interval=${intervalMinutes}min queue=[${state.queue.join(",")}]`);

  // 单次执行：读 todos → tick → 执行 actions
  const execute = (): void => {
    const todos = store.list();
    const { newState, actions } = tick(state, todos, defaultSessionExists);
    state = newState;

    for (const action of actions) {
      switch (action.type) {
        case "wait":
          // 本拍无事，不打日志避免噪音
          break;

        case "skip":
          log("warn", `skip ${action.id}: ${action.reason}`);
          break;

        case "trigger": {
          const cmd = buildSendKeysCommand(action.tmuxSessionId, message);
          try {
            execSync(cmd);
            log("info", `triggered ${action.id} (${action.title})`);
          } catch (e) {
            log("error", `send-keys failed for ${action.id}: ${(e as Error).message}`);
          }
          break;
        }

        case "terminate":
          log("info", `terminate: ${action.reason}`);
          cron.stop();
          process.exit(0);
      }
    }
  };

  // tick0：立刻执行一次
  execute();

  // 后续：cron 每 N 分钟触发
  const cronExpr = `*/${intervalMinutes} * * * *`;
  const cron = new Cron(cronExpr, execute);

  // 信号处理：优雅收尾
  const shutdown = (sig: string) => {
    log("info", `received ${sig}, stopping`);
    cron.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
```

- [ ] **Step 2: 类型检查确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 无输出（成功）。

- [ ] **Step 3: 把已有测试再跑一遍，确认没回归**

Run: `npx vitest run`
Expected: 所有既有测试（store / utils / services）全绿。

- [ ] **Step 4: Commit**

```bash
git add src/services/polling.ts
git commit -m "feat: add runPolling orchestrator with croner and tmux side effects"
```

---

## Task 5: CLI 入口 `src/scripts/polling.ts`

**Files:**
- Create: `src/scripts/polling.ts`

- [ ] **Step 1: 创建脚本入口**

```ts
#!/usr/bin/env -S npx --yes tsx
// CLI: npx tsx polling.ts --cwd <cwd> --message <text> [--interval <minutes>]

import { parseArgs } from "node:util";
import { runPolling } from "../services/polling.js";

function main(): void {
  const { values } = parseArgs({
    options: {
      cwd: { type: "string" },
      message: { type: "string" },
      interval: { type: "string", default: "1" },
    },
    strict: true,
  });

  if (!values.cwd) {
    console.error("missing --cwd");
    process.exit(2);
  }
  if (!values.message) {
    console.error("missing --message");
    process.exit(2);
  }

  const intervalMinutes = Number.parseInt(values.interval ?? "1", 10);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    console.error(`invalid --interval: ${values.interval} (must be integer ≥ 1)`);
    process.exit(2);
  }

  runPolling({
    cwd: values.cwd,
    message: values.message,
    intervalMinutes,
  });
}

main();
```

- [ ] **Step 2: 冒烟：用 `--help` 式的错误路径确认参数校验**

Run:
```bash
npx --yes tsx src/scripts/polling.ts --cwd /tmp
```
Expected: stderr 输出 `missing --message`，退出码 2。

Run:
```bash
npx --yes tsx src/scripts/polling.ts --cwd /tmp --message hi --interval 0
```
Expected: stderr 输出 `invalid --interval: 0 (must be integer ≥ 1)`，退出码 2。

- [ ] **Step 3: 冒烟：无 running 待办时应立即 terminate 并退出**

Run（在一个没有 `.harness/todos.json` 或 `todos.json` 里无 running 的临时目录）：
```bash
mkdir -p /tmp/polling-smoke && cd /tmp/polling-smoke
echo '[]' > .harness/todos.json || (mkdir -p .harness && echo '[]' > .harness/todos.json)
npx --yes tsx <repo-root>/src/scripts/polling.ts --cwd /tmp/polling-smoke --message hi
```
Expected: stdout 先打一行 `polling started: ... queue=[]`，再打一行 `terminate: no running todos`，进程在 1 秒内退出，退出码 0。

- [ ] **Step 4: 清理冒烟目录**

```bash
rm -rf /tmp/polling-smoke
```

- [ ] **Step 5: Commit**

```bash
git add src/scripts/polling.ts
git commit -m "feat: add polling CLI entry script"
```

---

## Task 6: 编写 `harness-todo-polling` SKILL.md

**Files:**
- Create: `skills/harness-todo-polling/SKILL.md`

- [ ] **Step 1: 写 skill 正文**

```markdown
---
name: harness-todo-polling
description: "Serially dispatch running harness todos via cron-driven tmux send-keys. Records all running todo IDs at start, polls every N minutes (default 1), and sends a user-provided trigger message to the next todo in queue whenever the current focus transitions to pending. Terminates when no todo is running anymore. Use when user wants to automate 'wake up the next todo when the current one is idle' — batch-continue running harness sessions."
---

# Harness Todo Polling

在后台 tmux 会话里跑一个 cron 轮询器，串行调度当前处于 `running` 状态的待办：焦点转 `pending` 就给下一个发 `tmux send-keys` 消息，整表无 `running` 时自终止。

## 输入

用户调用时，skill args 的整段文本按如下规则解析：

1. 匹配第一个出现的 `--interval <N>` 选项（N 为正整数分钟数，默认 1）
2. 剩余文本拼回，trim 后作为 **trigger message**
3. message 为空 → 告知用户并终止（不启动 polling）

示例：

- `/harness-todo-polling 继续下一步` → message = `继续下一步`，interval = 1
- `/harness-todo-polling --interval 5 请根据上一轮结论推进` → message = `请根据上一轮结论推进`，interval = 5

## 处理流程

### 1. 解析参数

从 skill args 里抽出 `--interval <N>` 和 message（见上）。

### 2. 校验 running 数量

```bash
npx --yes tsx -e "
import { TodoStore } from '<pluginRoot>/src/store.ts';
const store = new TodoStore(process.argv[1]);
const n = store.list().filter(t => t.status === 'running').length;
console.log(n);
" "<cwd>"
```

输出的 n：

- `n === 0` → 回复 `暂无 running 待办，无需轮询` 并结束
- `n >= 1` → 继续

### 3. 启动后台 tmux 会话

```bash
TS=$(date +%s)
SESSION="polling-${TS}"
tmux new-session -d -s "$SESSION" -c "<cwd>" \
  "npx --yes tsx '<pluginRoot>/src/scripts/polling.ts' \
     --cwd '<cwd>' --interval <N> --message '<escaped message>'"
```

message 里的单引号需要用 `'\''` 转义，和 `src/services/tmux.ts:buildSendKeysCommand` 的套路保持一致。

### 4. 回显

向用户输出一条确认：

> 已启动轮询会话 `polling-<ts>`，每 <N> 分钟推进一次。
> - `tmux attach -t polling-<ts>` 查看日志
> - `tmux kill-session -t polling-<ts>` 立即终止

然后结束当前 turn。

## 注意事项

- **会话名刻意不以 `harness-` 开头**：避开 `scripts/on-stop.sh` 的递归触发（该 hook 只对 `harness-*` 生效）。
- **并发多个 polling 允许**：会话名带时间戳，互不冲突；但每个都会独立读写 `tmux send-keys`，用户自己留意别把同一个待办同时推两下。
- **本 skill 不做状态修改**：只读 `.harness/todos.json`。trigger 消息本身会让目标会话的 `on-stop` 后续把状态刷到 `pending`（以及 `harness-session-send-user-message` 用户主动发则置 `running`），这些状态流转不由 polling 负责。
- **死会话自动跳过**：polling 期间若某待办的 tmux 会话已丢失（电脑重启等），polling 会日志一行后跳过，不做恢复；恢复责任归 `harness-session-send-user-message`。

## 相关 Skill

- `/harness-todo-list` — 查看待办表格确认谁在 running
- `/harness-session-send-user-message` — 手动给单个待办发消息（本 skill 的核心原语批量版）
- `/harness-todo-finish` — 结束某条待办；polling 会自动跳过已终态的项
```

- [ ] **Step 2: 人工校对：占位符是否齐全**

用 Grep 工具搜 SKILL.md 里是否还有 `<pluginRoot>` / `<cwd>` / `<N>` 这几类占位符——这些不是错别字，是 skill 执行时要 Claude 动态替换的"变量"，和其他 skill（`harness-todo-finish` 等）保持一致即可。

- [ ] **Step 3: Commit**

```bash
git add skills/harness-todo-polling/SKILL.md
git commit -m "feat: add harness-todo-polling SKILL.md"
```

---

## Task 7: 更新 README 增加 skill 说明

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 读 README 里 Skills 小节的当前内容**

Run（用 Read 工具）：读 `README.md` 第 46–53 行左右的 `## Skills` 列表。

- [ ] **Step 2: 追加一行**

在 `README.md` 的 Skills 列表末尾新增一行：

```markdown
- `/harness-todo-polling` — Start a background cron poller that serially wakes up running todos via tmux send-keys
```

保持和既有条目相同的格式（前面两个字符 `- `、skill 名用反引号、破折号后英文描述一句话）。

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: list harness-todo-polling in README skills"
```

---

## Task 8: 端到端冒烟

在真实 tmux + Claude 环境里跑一遍闭环。**这一 task 不做 TDD，目标是验证 task1–7 拼接起来能 work。**

**Files:** 不新增，只验证。

- [ ] **Step 1: 造两个 running 待办**

在一个干净工作目录里依次调用 `/harness-todo-create` 创建两个待办 T1、T2。等它们的状态都变为 `running`（等 Claude 启动完），随后等 Claude 跑完第一轮（`on-stop.sh` 会把它们刷回 `pending`），再手动用 `harness-session-send-user-message` 给 T1 / T2 各发一条消息把状态改回 `running`——此时两个都是 `running` 等待下一步指令。

- [ ] **Step 2: 启动 polling**

调用 `/harness-todo-polling --interval 1 继续下一步`。

预期：
1. skill 回显 polling 会话名
2. `tmux attach -t polling-<ts>` 能看到首行 `polling started: ... queue=[<T1.id>,<T2.id>]`
3. 立刻有一行 `triggered <T1.id>`
4. 验证 T1 的 tmux 会话（`tmux attach -t harness-<T1.id>`）里出现"继续下一步"这条用户消息

- [ ] **Step 3: 触发焦点转移**

等 T1 的 Claude 跑完这一轮 → `on-stop.sh` 把 T1 刷为 `pending` → polling 下一拍（≤ 1 分钟内）应该：
- 日志里多一行 `triggered <T2.id>`
- T2 的 tmux 会话（`tmux attach -t harness-<T2.id>`）收到"继续下一步"

- [ ] **Step 4: 验证自终止**

手动把 T1、T2 都 `/harness-todo-finish`（标记 `done`）。等 polling 下一拍。

预期：polling 日志打 `terminate: no running todos`，`polling-<ts>` tmux 会话自动消失（内部进程退出）。

- [ ] **Step 5: 如果有问题回到对应 task 修复**

不做额外 commit；只是验证。

---

## Self-Review

1. **Spec 覆盖**：
   - 串行调度 → Task 3 tick + Task 4 runner ✓
   - 启动首发 tick0 → Task 4 runner 里 `execute()` 被 tick0 式调用 ✓
   - 动态扩队 → Task 3 "队列耗尽的动态扩队" 测试 + 实现 ✓
   - 跳过死会话并从队列移除 → Task 3 "跳过 tmux 会话已丢失" + seen 集合 ✓
   - 无 running 时自终止 → Task 3 "整表无 running 时返回 terminate" + runner 里 `terminate` 分支 ✓
   - CLI 参数 message / --interval → Task 5 + Task 6 ✓
   - 后台 tmux 会话 → Task 6 skill 正文 ✓
   - croner 依赖 → Task 1 ✓
   - README 同步 → Task 7 ✓
   - 端到端验证 → Task 8 ✓

2. **占位符扫描**：全文 `<pluginRoot>` / `<cwd>` / `<N>` / `<ts>` / `<escaped message>` / `<T1.id>` / `<T2.id>` / `<repo-root>` 都是"skill 执行时要被 Claude / 执行者替换的变量"，不是计划缺口。没有 TBD / TODO / "implement later"。

3. **类型一致性**：
   - `PollingState` 字段 `queue / focusIndex / seen` 在 Task 2、Task 3、Task 4 都一致 ✓
   - `Action` 的四种类型 `wait / terminate / trigger / skip` 在测试和实现里一致 ✓
   - `trigger` 附带字段 `id / tmuxSessionId / title` 在测试和 runner dispatcher 里一致 ✓
   - `RunPollingOptions` 字段 `cwd / message / intervalMinutes` 与 Task 5 CLI 解析结果一致 ✓
   - `buildSendKeysCommand` 签名在 `src/services/tmux.ts` 已有 `(sessionName, text) => string`，Task 4 调用一致 ✓
