# Tmux Session Auto-Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/harness-session-send-user-message` 和 `/harness-todo-polling` 在发现关联 tmux 会话丢失时自动恢复：优先 `claude --resume <claudeSessionId>` 接回原对话，缺 `claudeSessionId` 时用原始 title/description 全新 spawn。

**Architecture:** 新增 `src/services/recovery.ts`，对外导出 `ensureSessionAlive(cwd, todo, deps)`。函数内部先 `tmux has-session` 判活，挂了再按 `claudeSessionId` 是否有值选分支。两个调用方（polling runner、send-message skill）在 send-keys 前统一调用它，生产环境通过 `createDefaultDeps(cwd)` 注入真实副作用实现。

**Tech Stack:** TypeScript + Node `child_process.execSync` + vitest。复用现有 `src/services/tmux.ts` 的 `buildClaudeCommand` 做全新 spawn 命令。

---

## File Structure

**Create:**
- `src/services/recovery.ts` — `ensureSessionAlive` 以及纯函数 `decideRecoveryAction` / `buildResumeCommand` / `parseRemoteControlUrl`
- `tests/services/recovery.test.ts` — 单测

**Modify:**
- `src/services/polling.ts` — 去掉 tick 里"tmux 丢失就 skip"的分支；runner 的 `trigger` 处理里调用 `ensureSessionAlive`
- `tests/services/polling.test.ts` — 删掉/改写依赖旧"skip tmux missing"语义的用例
- `skills/harness-session-send-user-message/SKILL.md` — 第 3/3a 步替换成 `ensureSessionAlive` 调用；去掉 y/n 确认和 reject→failed 分支

---

## Task 1: 纯函数 `decideRecoveryAction`

**Files:**
- Create: `src/services/recovery.ts`
- Test: `tests/services/recovery.test.ts`

决定恢复动作的核心决策：输入 `todo` 和 `sessionAlive` 布尔，输出 `'noop' | 'resume' | 'fresh'`。

- [ ] **Step 1: 写失败测试**

`tests/services/recovery.test.ts`：
```typescript
import { describe, it, expect } from "vitest";
import { decideRecoveryAction } from "../../src/services/recovery.js";
import type { TodoItem } from "../../src/types.js";

const mkTodo = (overrides: Partial<TodoItem> = {}): TodoItem => ({
  id: "abc",
  title: "t",
  description: "d",
  status: "running",
  tmuxSessionId: "harness-abc",
  remoteControlUrl: "",
  claudeSessionId: "session_xxx",
  claudeSessionName: "[HARNESS_SESSION]t",
  firstMessageSent: false,
  ...overrides,
});

describe("decideRecoveryAction", () => {
  it("tmux 活着 → noop", () => {
    expect(decideRecoveryAction(mkTodo(), true)).toBe("noop");
  });

  it("status 非 running → noop", () => {
    expect(decideRecoveryAction(mkTodo({ status: "pending" }), false)).toBe("noop");
    expect(decideRecoveryAction(mkTodo({ status: "done" }), false)).toBe("noop");
    expect(decideRecoveryAction(mkTodo({ status: "failed" }), false)).toBe("noop");
  });

  it("running + 挂 + 有 claudeSessionId → resume", () => {
    expect(decideRecoveryAction(mkTodo(), false)).toBe("resume");
  });

  it("running + 挂 + 无 claudeSessionId → fresh", () => {
    expect(decideRecoveryAction(mkTodo({ claudeSessionId: "" }), false)).toBe("fresh");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/services/recovery.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/recovery'`

- [ ] **Step 3: 最小实现**

创建 `src/services/recovery.ts`：
```typescript
import type { TodoItem } from "../types.js";

export type RecoveryAction = "noop" | "resume" | "fresh";

export function decideRecoveryAction(
  todo: TodoItem,
  sessionAlive: boolean
): RecoveryAction {
  if (sessionAlive) return "noop";
  if (todo.status !== "running") return "noop";
  if (todo.claudeSessionId) return "resume";
  return "fresh";
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/services/recovery.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 提交**

```bash
git add src/services/recovery.ts tests/services/recovery.test.ts
git commit -m "feat(recovery): add decideRecoveryAction pure decider"
```

---

## Task 2: 纯函数 `buildResumeCommand`

**Files:**
- Modify: `src/services/recovery.ts`
- Modify: `tests/services/recovery.test.ts`

分支 A 用的 `tmux new-session` 完整命令字符串。

- [ ] **Step 1: 追加失败测试**

在 `tests/services/recovery.test.ts` 末尾追加：
```typescript
import { buildResumeCommand } from "../../src/services/recovery.js";

describe("buildResumeCommand", () => {
  it("构造 tmux new-session + claude --resume 命令（不带 --remote-control）", () => {
    const todo = mkTodo({
      tmuxSessionId: "harness-abc",
      claudeSessionId: "session_xxx",
      claudeSessionName: "[HARNESS_SESSION]t",
    });
    const cmd = buildResumeCommand(todo);
    expect(cmd).toContain("tmux new-session -d -s harness-abc");
    expect(cmd).toContain("claude -n '[HARNESS_SESSION]t'");
    expect(cmd).toContain("--resume session_xxx");
    expect(cmd).not.toContain("--remote-control");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/services/recovery.test.ts -t buildResumeCommand`
Expected: FAIL — `buildResumeCommand is not defined`

- [ ] **Step 3: 实现**

在 `src/services/recovery.ts` 追加：
```typescript
export function buildResumeCommand(todo: TodoItem): string {
  const inner = `claude -n '${todo.claudeSessionName}' --resume ${todo.claudeSessionId}`;
  return `tmux new-session -d -s ${todo.tmuxSessionId} "${inner}"`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/services/recovery.test.ts`
Expected: PASS (全部通过)

- [ ] **Step 5: 提交**

```bash
git add src/services/recovery.ts tests/services/recovery.test.ts
git commit -m "feat(recovery): add buildResumeCommand"
```

---

## Task 3: 纯函数 `buildFreshSpawnCommand`

**Files:**
- Modify: `src/services/recovery.ts`
- Modify: `tests/services/recovery.test.ts`

分支 B 用的命令，复用 `src/services/tmux.ts` 里已有的 `buildClaudeCommand` + `buildCreateSessionCommand` 组合。

- [ ] **Step 1: 追加失败测试**

```typescript
import { buildFreshSpawnCommand } from "../../src/services/recovery.js";

describe("buildFreshSpawnCommand", () => {
  it("调 buildClaudeCommand 组装 --remote-control 提示，用 todo 的 title/description/id", () => {
    const todo = mkTodo({
      id: "abc",
      title: "修复登录 bug",
      description: "登录按钮点击无反应",
      tmuxSessionId: "harness-abc",
      claudeSessionName: "[HARNESS_SESSION]修复登录 bug",
    });
    const cmd = buildFreshSpawnCommand(todo);
    expect(cmd).toContain("tmux new-session -d -s harness-abc");
    expect(cmd).toContain("--remote-control");
    expect(cmd).toContain("修复登录 bug");
    expect(cmd).toContain("登录按钮点击无反应");
    expect(cmd).toContain("abc");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/services/recovery.test.ts -t buildFreshSpawnCommand`
Expected: FAIL — `buildFreshSpawnCommand is not defined`

- [ ] **Step 3: 实现**

在 `src/services/recovery.ts` 文件顶部加 import，并追加函数：
```typescript
import { buildClaudeCommand, buildCreateSessionCommand } from "./tmux.js";

export function buildFreshSpawnCommand(todo: TodoItem): string {
  const claudeCommand = buildClaudeCommand({
    sessionName: todo.claudeSessionName,
    todoId: todo.id,
    title: todo.title,
    description: todo.description,
  });
  return buildCreateSessionCommand({
    sessionName: todo.tmuxSessionId,
    claudeCommand,
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/services/recovery.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/services/recovery.ts tests/services/recovery.test.ts
git commit -m "feat(recovery): add buildFreshSpawnCommand"
```

---

## Task 4: 纯函数 `parseRemoteControlUrl`

**Files:**
- Modify: `src/services/recovery.ts`
- Modify: `tests/services/recovery.test.ts`

从 `tmux capture-pane -p` 的输出里提取 `https://claude.ai/code/session_...` 这条 URL，用于分支 B 回写 `remoteControlUrl`。

- [ ] **Step 1: 追加失败测试**

```typescript
import { parseRemoteControlUrl } from "../../src/services/recovery.js";

describe("parseRemoteControlUrl", () => {
  it("从多行输出中提取 claude.ai/code/session_... URL", () => {
    const pane = `Welcome to Claude Code
Session started
Remote control: https://claude.ai/code/session_abc123def
Ready.`;
    expect(parseRemoteControlUrl(pane)).toBe(
      "https://claude.ai/code/session_abc123def"
    );
  });

  it("没匹配到时返回 undefined", () => {
    expect(parseRemoteControlUrl("no url here")).toBeUndefined();
    expect(parseRemoteControlUrl("")).toBeUndefined();
  });

  it("取第一条匹配", () => {
    const pane = `https://claude.ai/code/session_first
https://claude.ai/code/session_second`;
    expect(parseRemoteControlUrl(pane)).toBe(
      "https://claude.ai/code/session_first"
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/services/recovery.test.ts -t parseRemoteControlUrl`
Expected: FAIL

- [ ] **Step 3: 实现**

在 `src/services/recovery.ts` 追加：
```typescript
export function parseRemoteControlUrl(paneOutput: string): string | undefined {
  const match = paneOutput.match(/https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/);
  return match?.[0];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/services/recovery.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/services/recovery.ts tests/services/recovery.test.ts
git commit -m "feat(recovery): add parseRemoteControlUrl"
```

---

## Task 5: `ensureSessionAlive` 主流程（依赖注入形式）

**Files:**
- Modify: `src/services/recovery.ts`
- Modify: `tests/services/recovery.test.ts`

把副作用都抽成 deps 参数，核心函数用纯调度，单测用 stub 覆盖四条路径和分支 A 退化成分支 B 的场景。

- [ ] **Step 1: 追加失败测试**

```typescript
import { ensureSessionAlive } from "../../src/services/recovery.js";
import type { RecoveryDeps } from "../../src/services/recovery.js";

function makeDeps(overrides: Partial<RecoveryDeps> = {}): {
  deps: RecoveryDeps;
  calls: string[];
  updates: Record<string, Partial<TodoItem>>;
} {
  const calls: string[] = [];
  const updates: Record<string, Partial<TodoItem>> = {};
  const deps: RecoveryDeps = {
    sessionExists: (name) => {
      calls.push(`has:${name}`);
      return false;
    },
    exec: (cmd) => {
      calls.push(`exec:${cmd}`);
    },
    capturePane: () => {
      calls.push(`capture`);
      return "https://claude.ai/code/session_new";
    },
    sleep: () => {
      calls.push("sleep");
    },
    updateTodo: (id, patch) => {
      calls.push(`update:${id}`);
      updates[id] = { ...(updates[id] ?? {}), ...patch };
    },
    log: () => {
      calls.push("log");
    },
    ...overrides,
  };
  return { deps, calls, updates };
}

describe("ensureSessionAlive", () => {
  const runningTodo = mkTodo();

  it("tmux 活着 → 只调一次 has-session 就返回", () => {
    const { deps, calls } = makeDeps({
      sessionExists: () => true,
    });
    ensureSessionAlive("/cwd", runningTodo, deps);
    expect(calls.filter((c) => c.startsWith("exec:")).length).toBe(0);
    expect(calls.some((c) => c.startsWith("has:"))).toBe(true);
  });

  it("status 非 running → 不做恢复", () => {
    const { deps, calls } = makeDeps();
    ensureSessionAlive("/cwd", mkTodo({ status: "done" }), deps);
    expect(calls.filter((c) => c.startsWith("exec:")).length).toBe(0);
  });

  it("有 claudeSessionId → 跑 resume 命令，不抓 URL，不改 firstMessageSent", () => {
    // 第一次 has-session 返回 false（触发恢复），第二次返回 true（确认起来）
    let callNo = 0;
    const { deps, calls, updates } = makeDeps({
      sessionExists: () => {
        callNo++;
        return callNo >= 2;
      },
    });
    ensureSessionAlive("/cwd", runningTodo, deps);
    const execCalls = calls.filter((c) => c.startsWith("exec:"));
    expect(execCalls.length).toBe(1);
    expect(execCalls[0]).toContain("--resume session_xxx");
    expect(execCalls[0]).not.toContain("--remote-control");
    expect(calls).not.toContain("capture");
    expect(updates["abc"]).toBeUndefined();
  });

  it("无 claudeSessionId → 跑 fresh 命令，抓 URL，重置 firstMessageSent", () => {
    let callNo = 0;
    const { deps, calls, updates } = makeDeps({
      sessionExists: () => {
        callNo++;
        return callNo >= 2;
      },
    });
    const todo = mkTodo({
      claudeSessionId: "",
      firstMessageSent: true,
    });
    ensureSessionAlive("/cwd", todo, deps);
    const execCalls = calls.filter((c) => c.startsWith("exec:"));
    expect(execCalls.length).toBe(1);
    expect(execCalls[0]).toContain("--remote-control");
    expect(updates["abc"]).toEqual({
      remoteControlUrl: "https://claude.ai/code/session_new",
      firstMessageSent: false,
    });
  });

  it("分支 A resume 启动失败（第二次 has-session 仍然 false）→ 退化到分支 B", () => {
    // has 调用序列：第一次 false（初始挂）、第二次 false（resume 后仍挂，触发退化）、
    // 第三次 true（B 的 new-session 起来了）
    let callNo = 0;
    const { deps, calls, updates } = makeDeps({
      sessionExists: () => {
        callNo++;
        return callNo >= 3;
      },
    });
    ensureSessionAlive("/cwd", runningTodo, deps);
    const execCalls = calls.filter((c) => c.startsWith("exec:"));
    expect(execCalls.length).toBe(2);
    expect(execCalls[0]).toContain("--resume");
    expect(execCalls[1]).toContain("--remote-control");
    // 分支 B 始终重置 firstMessageSent；但此处 runningTodo.firstMessageSent 为 false，
    // 仍然应该显式写一次 false 保持语义一致
    expect(updates["abc"]).toMatchObject({ firstMessageSent: false });
  });

  it("两个分支都失败 → 抛错", () => {
    const { deps } = makeDeps({
      sessionExists: () => false, // 永远挂
    });
    expect(() => ensureSessionAlive("/cwd", runningTodo, deps)).toThrow(
      /recover/i
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/services/recovery.test.ts -t ensureSessionAlive`
Expected: FAIL — `ensureSessionAlive is not defined`

- [ ] **Step 3: 实现**

在 `src/services/recovery.ts` 追加：
```typescript
export interface RecoveryDeps {
  /** tmux has-session 的包装，true = 活着 */
  sessionExists: (tmuxSessionId: string) => boolean;
  /** 执行任意 shell 命令（tmux new-session 等），失败允许抛错 */
  exec: (cmd: string) => void;
  /** tmux capture-pane -p 的结果，只在分支 B 用 */
  capturePane: (tmuxSessionId: string) => string;
  /** 同步 sleep 指定毫秒，阻塞直到返回；测试里替换成 no-op */
  sleep: (ms: number) => void;
  /** 更新 todo 记录的部分字段 */
  updateTodo: (id: string, patch: Partial<TodoItem>) => void;
  /** 日志落盘/控制台，测试里替换成 no-op */
  log: (line: string) => void;
}

/**
 * 保证 todo.tmuxSessionId 对应的 tmux 会话活着。
 * 已经活着 / status 非 running → 直接返回；
 * 否则按 claudeSessionId 决定走 resume 还是 fresh；
 * resume 起不来时退化到 fresh；fresh 也失败则抛错。
 */
export function ensureSessionAlive(
  cwd: string,
  todo: TodoItem,
  deps: RecoveryDeps
): void {
  const aliveNow = deps.sessionExists(todo.tmuxSessionId);
  const action = decideRecoveryAction(todo, aliveNow);
  if (action === "noop") return;

  if (action === "resume") {
    try {
      deps.exec(buildResumeCommand(todo));
    } catch (err) {
      // new-session 已经存在等错误一律走二次 has-session 判定
    }
    deps.sleep(2000);
    if (deps.sessionExists(todo.tmuxSessionId)) {
      deps.log(
        `${new Date().toISOString()} todo=${todo.id} branch=A result=ok`
      );
      return;
    }
    // 退化到分支 B
    deps.log(
      `${new Date().toISOString()} todo=${todo.id} branch=A result=failed, falling back to B`
    );
  }

  // 分支 B（action === "fresh" 或 A 退化）
  try {
    deps.exec(buildFreshSpawnCommand(todo));
  } catch (err) {
    // 同上，统一交给二次 has-session 兜底
  }
  deps.sleep(2000);
  if (!deps.sessionExists(todo.tmuxSessionId)) {
    deps.log(
      `${new Date().toISOString()} todo=${todo.id} branch=B result=failed`
    );
    throw new Error(
      `failed to recover tmux session for todo ${todo.id}`
    );
  }

  // 抓 URL、更新记录
  const pane = deps.capturePane(todo.tmuxSessionId);
  const url = parseRemoteControlUrl(pane);
  const patch: Partial<TodoItem> = { firstMessageSent: false };
  if (url) patch.remoteControlUrl = url;
  deps.updateTodo(todo.id, patch);

  deps.log(
    `${new Date().toISOString()} todo=${todo.id} branch=B result=ok`
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/services/recovery.test.ts`
Expected: PASS（全部通过）

- [ ] **Step 5: 提交**

```bash
git add src/services/recovery.ts tests/services/recovery.test.ts
git commit -m "feat(recovery): add ensureSessionAlive with resume/fresh fallback"
```

---

## Task 6: 默认 deps 工厂（生产环境接入 execSync / fs / TodoStore）

**Files:**
- Modify: `src/services/recovery.ts`

把测试里的 `RecoveryDeps` 配套一份生产实现，暴露 `createDefaultDeps(cwd)` 工厂。这层**不写单测**（纯粘合 execSync/fs/TodoStore），交给集成阶段手工验证。

- [ ] **Step 1: 在 `src/services/recovery.ts` 追加工厂函数**

```typescript
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TodoStore } from "../store.js";

export function createDefaultDeps(cwd: string): RecoveryDeps {
  const store = new TodoStore(cwd);
  const logPath = path.join(
    process.env.CLAUDE_PLUGIN_ROOT ?? cwd,
    "log",
    "recovery.log"
  );
  return {
    sessionExists: (name) => {
      if (!name) return false;
      try {
        execSync(`tmux has-session -t ${JSON.stringify(name)} 2>/dev/null`, {
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    },
    exec: (cmd) => {
      execSync(cmd, { stdio: "pipe" });
    },
    capturePane: (name) => {
      try {
        return execSync(`tmux capture-pane -t ${JSON.stringify(name)} -p`, {
          encoding: "utf-8",
        });
      } catch {
        return "";
      }
    },
    sleep: (ms) => {
      execSync(`sleep ${ms / 1000}`);
    },
    updateTodo: (id, patch) => {
      store.update(id, patch);
    },
    log: (line) => {
      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, line + "\n");
      } catch {
        // 日志失败不影响主流程
      }
    },
  };
}
```

- [ ] **Step 2: 跑一次全量测试确认没回归**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/services/recovery.ts
git commit -m "feat(recovery): add production default deps factory"
```

---

## Task 7: polling tick 不再 skip tmux 丢失的 todo

**Files:**
- Modify: `src/services/polling.ts:102-107`
- Modify: `tests/services/polling.test.ts:84-100`

Tick 原本在遇到死 tmux 会话时把 todo skip 掉。接入恢复逻辑后，tick 应当信任恢复，只要是 running 且 tmuxSessionId 非空就 trigger；是否真的活着由 runner 调 `ensureSessionAlive` 兜底。

- [ ] **Step 1: 改写失败测试**

把 `tests/services/polling.test.ts:84-100` 用例替换为：

```typescript
it("tmux 会话已丢失时也返回 trigger（恢复交给 runner）", () => {
  const state = { queue: ["a", "b", "c"], focusIndex: 0, seen: new Set(["a"]) };
  const todos = [
    todo("a", "pending"),
    todo("b", "running", "harness-b"),
    todo("c", "running", "harness-c"),
  ];
  // b 的 tmux 即便死了也应进入 trigger
  const exists = (id: string) => id === "harness-c";
  const { actions, newState } = tick(state, todos, exists);
  expect(actions).toEqual([
    { type: "trigger", id: "b", tmuxSessionId: "harness-b", title: "todo-b" },
  ]);
  expect(newState.focusIndex).toBe(1);
  expect(Array.from(newState.seen).sort()).toEqual(["a", "b"]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/services/polling.test.ts`
Expected: FAIL — 旧实现把 b 当作 `skip` 处理

- [ ] **Step 3: 改 `src/services/polling.ts`**

删掉第 102-107 行这一段：
```typescript
    // 3d. tmux 会话已丢失
    if (!sessionExists(nextTodo.tmuxSessionId)) {
      actions.push({ type: "skip", id: nextId, reason: "tmux session missing" });
      seen.add(nextId);
      continue;
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/services/polling.test.ts`
Expected: PASS

> 注：`sessionExists` 参数和 `liveSession` 测试辅助暂时保留。Task 8 再处理是否彻底移除它。

- [ ] **Step 5: 提交**

```bash
git add src/services/polling.ts tests/services/polling.test.ts
git commit -m "refactor(polling): stop skipping missing-tmux todos in tick"
```

---

## Task 8: polling runner 在 trigger 前调用 `ensureSessionAlive`

**Files:**
- Modify: `src/services/polling.ts` (runner 的 `execute` 函数里 `case "trigger"` 分支)

- [ ] **Step 1: 改 `src/services/polling.ts` 的 `execute` 函数**

找到 `case "trigger":` 分支（第 179-188 行附近），改成：

```typescript
case "trigger": {
  const todo = store.get(action.id);
  if (!todo) {
    log("warn", `trigger skipped: todo ${action.id} not found`);
    break;
  }
  try {
    ensureSessionAlive(cwd, todo, createDefaultDeps(cwd));
  } catch (e) {
    log("error", `recovery failed for ${action.id}: ${(e as Error).message}`);
    break;
  }
  const cmd = buildSendKeysCommand(action.tmuxSessionId, message);
  try {
    execSync(cmd);
    log("info", `triggered ${action.id} (${action.title})`);
  } catch (e) {
    log("error", `send-keys failed for ${action.id}: ${(e as Error).message}`);
  }
  break;
}
```

在文件顶部 import 区追加：
```typescript
import { ensureSessionAlive, createDefaultDeps } from "./recovery.js";
```

- [ ] **Step 2: 跑一次全量测试确认没回归**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/services/polling.ts
git commit -m "feat(polling): auto-recover tmux session before send-keys trigger"
```

---

## Task 9: send-user-message skill 改用 `ensureSessionAlive`

**Files:**
- Modify: `skills/harness-session-send-user-message/SKILL.md`

原来第 3 步里的"检测 tmux 是否存在 → 没有就 y/n 问用户"整段替换成一次 `ensureSessionAlive` 调用；去掉用户拒绝就标记 failed 的分支（恢复是无条件自动的）。

- [ ] **Step 1: 改 SKILL.md**

把 `skills/harness-session-send-user-message/SKILL.md` 的第 84-134 行（从第 3 步开头到 3a 结尾）替换成下面内容：

```markdown
### 3. 发送消息

拿到 `todo` 后，按以下顺序处理：

1. **无条件将 `todo.status` 更新为 `running`**：

   ```bash
   npx tsx -e "
   import { TodoStore } from '<plugin-dir>/src/store.ts';
   const store = new TodoStore(process.argv[1]);
   store.update(process.argv[2], { status: 'running' });
   " "<cwd>" "<todo.id>"
   ```

2. `todo.tmuxSessionId` 为空 → 输出 `tmux 会话已关闭` 并终止。

3. 自动确保 tmux 会话活着（丢失则自动 resume / 全新 spawn）：

   ```bash
   npx tsx -e "
   import { TodoStore } from '<plugin-dir>/src/store.ts';
   import { ensureSessionAlive, createDefaultDeps } from '<plugin-dir>/src/services/recovery.ts';
   const store = new TodoStore(process.argv[1]);
   const todo = store.get(process.argv[2]);
   if (!todo) { console.error('todo not found'); process.exit(1); }
   ensureSessionAlive(process.argv[1], todo, createDefaultDeps(process.argv[1]));
   " "<cwd>" "<todo.id>"
   ```

   - 退出码 0 → 会话可用，继续第 4 步
   - 非零退出 → 把 stderr 里 `ensureSessionAlive` 抛出的信息直接展示给用户；不再自动改 `status` 为 failed（由用户决定下一步）
```

同时把第 175-183 行"错误文案对照"表里的这一行：

```markdown
| tmux 会话已丢失（重启等） | 提示用户是否恢复；拒绝则标记 failed |
```

替换为：

```markdown
| tmux 会话已丢失（重启等） | 自动恢复；恢复失败时把 `ensureSessionAlive` 的错误原样展示 |
```

- [ ] **Step 2: 手工 sanity：把 SKILL.md 从头到尾读一遍**

确认没有遗留的 `3a. 会话恢复`、`是否重新创建会话`、`已将待办项状态标记为 failed` 文案。

- [ ] **Step 3: 提交**

```bash
git add skills/harness-session-send-user-message/SKILL.md
git commit -m "docs(send-message): auto-recover tmux via ensureSessionAlive"
```

---

## Task 10: 全量测试 + 手工集成验证

**Files:** N/A（运行测试 + 真实跑一次 harness 流程）

- [ ] **Step 1: 全量测试**

Run: `npx vitest run`
Expected: 全部 PASS，无 console error / warning

- [ ] **Step 2: 类型检查（如果仓库有 tsc）**

Run: `npx tsc --noEmit`
Expected: 没有类型错误（现有 tmux.test.ts 里 `buildClaudeCommand` 缺字段的调用是 tests 目录、被 tsconfig 排除，允许保留）

- [ ] **Step 3: 手工跑一次 resume 分支**

```bash
# 1. 起一个测试 todo
/harness-todo-create "测试 auto-resume"
# 记下 id，比如 xyz

# 2. 主动杀掉 tmux 会话
tmux kill-session -t harness-xyz

# 3. 确认 tmux 已经没了
tmux has-session -t harness-xyz 2>&1 # 应返回 "no server running" 或 "can't find session"

# 4. 通过 send-message 触发恢复
/harness-session-send-user-message xyz "验证一下历史对话还在"

# 5. tmux attach 回去检查历史
tmux attach -t harness-xyz
# 预期：能看到之前的对话（不是全新的 Claude 开场），刚发的消息已投递
```

- [ ] **Step 4: 手工跑一次分支 B（无 claudeSessionId）**

```bash
# 1. 起一个测试 todo
/harness-todo-create "测试 fresh fallback"
# 记下 id，比如 def

# 2. 手动把 todos.json 里该条的 claudeSessionId 改成空串，并 kill tmux
# （编辑 .harness/todos.json）
tmux kill-session -t harness-def

# 3. 触发
/harness-session-send-user-message def "触发分支 B"

# 4. tmux attach 验证
tmux attach -t harness-def
# 预期：全新的 Claude 会话，task 描述作为首消息被喂进去，用户消息也到了；
# 预期：todos.json 里 firstMessageSent=false, remoteControlUrl 更新
```

- [ ] **Step 5: 查看恢复日志**

```bash
cat <plugin-dir>/log/recovery.log
```

Expected: 能看到 `branch=A result=ok` 和 `branch=B result=ok` 各一条

- [ ] **Step 6: 版本号 bump + 提交**

```bash
# 按仓库惯例（最近几次 chore: 更新版本至 0.1.23）把 package.json 版本 +1
npx tsx scripts/sync-version.mjs  # 若仓库有这个脚本
# 或手工改 package.json
git add package.json
git commit -m "chore: 更新版本至 <new-version>"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `ensureSessionAlive` 作为统一入口 — Task 5
- ✅ 分支 A（resume，不带 --remote-control） — Task 2 + 5
- ✅ 分支 B（fresh spawn + 重抓 URL + 重置 firstMessageSent） — Task 3 + 5
- ✅ resume 失败退化到 fresh — Task 5 测试用例 5
- ✅ 并发保护（new-session 失败后二次 has-session 判定） — Task 5 的 try/catch 吞掉 exec 错误 + 二次 sessionExists
- ✅ 日志写入 `log/recovery.log` — Task 6
- ✅ polling 调用点 — Task 7 + 8
- ✅ send-message 调用点 — Task 9
- ✅ `harness-todo-finish` / `harness-todo-remove` 不动 — 设计外，确认未涉及
- ✅ `harness-todo-list` 不动 — 设计外，确认未涉及

**Placeholder scan:** 无 TBD / TODO / "similar to taskN" / 裸空的步骤。

**Type consistency:** `RecoveryAction` / `RecoveryDeps` / `ensureSessionAlive` / `decideRecoveryAction` / `buildResumeCommand` / `buildFreshSpawnCommand` / `parseRemoteControlUrl` / `createDefaultDeps` 在所有 Task 里保持同名。
