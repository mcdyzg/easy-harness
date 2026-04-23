import { execSync } from "node:child_process";
import { Cron } from "croner";
import type { TodoItem } from "../types.js";
import { TodoStore } from "../store.js";
import { buildSendKeysCommand } from "./tmux.js";
import { ensureSessionAlive, createDefaultDeps } from "./recovery.js";
import { debugLog } from "../utils/debug-log.js";

/** polling 进程内的运行时状态。纯数据，`tick` 不会在原对象上写入 */
export interface PollingState {
  /** 焦点候选队列，按插入顺序 */
  queue: string[];
  /** 当前焦点在 queue 中的下标；-1 代表尚未开始（tick0 前） */
  focusIndex: number;
  /** 已 trigger 或已跳过（tmuxSessionId 为空 / 记录消失）的 id；动态扩队时用它过滤 */
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

export type Action =
  | { type: "wait" }
  | { type: "terminate"; reason: string }
  | { type: "trigger"; id: string; tmuxSessionId: string; title: string }
  | { type: "skip"; id: string; reason: string };

/**
 * 纯函数：基于当前状态与 todos 快照决定下一步。
 * 不修改传入的 state / seen；返回新 state + 动作序列，交给 runner 执行。
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
      const queueSet = new Set(queue);
      const newIds = todos
        .filter((t) => t.status === "running" && !queueSet.has(t.id) && !seen.has(t.id))
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

    // 3d. 命中有效候选，发 trigger
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

  const initialTodos = store.list();
  let state = initialState(initialTodos);
  log("info", `polling started: cwd=${cwd} interval=${intervalMinutes}min queue=[${state.queue.join(",")}]`);
  debugLog("polling", "start", {
    cwd,
    intervalMinutes,
    messageLen: message.length,
    messagePreview: message.slice(0, 120),
    queue: state.queue,
    totalTodos: initialTodos.length,
    statusCounts: initialTodos.reduce<Record<string, number>>((acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1;
      return acc;
    }, {}),
  });

  // cron 提前声明：execute() 在 tick0 路径可能早于 new Cron 就要引用它
  let cron: Cron | undefined;

  // 单次执行：读 todos → tick → 执行 actions
  const execute = (): void => {
    const todos = store.list();
    const focusId = state.focusIndex >= 0 ? state.queue[state.focusIndex] : undefined;
    debugLog("polling", "tick-begin", {
      cwd,
      focusIndex: state.focusIndex,
      focusId,
      queue: state.queue,
      queueLen: state.queue.length,
      seenCount: state.seen.size,
      runningCount: todos.filter((t) => t.status === "running").length,
      totalTodos: todos.length,
    });
    const { newState, actions } = tick(state, todos, defaultSessionExists);
    state = newState;
    debugLog("polling", "tick-decision", {
      focusIndex: state.focusIndex,
      actions: actions.map((a) => a.type),
      actionDetails: actions,
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
            debugLog("polling", "trigger-miss", { id: action.id });
            log("warn", `trigger skipped: todo ${action.id} not found`);
            break;
          }
          debugLog("polling", "trigger", {
            id: action.id,
            tmuxSessionId: action.tmuxSessionId,
            title: action.title,
            status: todo.status,
            claudeSessionId: todo.claudeSessionId,
            messageLen: message.length,
            messagePreview: message.slice(0, 120),
          });
          const recoveryStart = Date.now();
          try {
            ensureSessionAlive(cwd, todo, createDefaultDeps(cwd));
            debugLog("polling", "recovery-ok", {
              id: action.id,
              durationMs: Date.now() - recoveryStart,
            });
          } catch (e) {
            debugLog("polling", "recovery-fail", {
              id: action.id,
              durationMs: Date.now() - recoveryStart,
              error: (e as Error).message,
            });
            log("error", `recovery failed for ${action.id}: ${(e as Error).message}`);
            break;
          }
          const cmd = buildSendKeysCommand(todo.tmuxSessionId, message);
          const start = Date.now();
          try {
            execSync(cmd);
            debugLog("polling", "send-keys-ok", {
              id: action.id,
              tmuxSessionId: todo.tmuxSessionId,
              cmd,
              durationMs: Date.now() - start,
            });
            log("info", `triggered ${action.id} (${action.title})`);
          } catch (e) {
            const err = e as { stderr?: Buffer | string; message?: string };
            const stderr = err?.stderr
              ? typeof err.stderr === "string"
                ? err.stderr
                : err.stderr.toString("utf-8")
              : undefined;
            debugLog("polling", "send-keys-fail", {
              id: action.id,
              tmuxSessionId: todo.tmuxSessionId,
              cmd,
              durationMs: Date.now() - start,
              error: (e as Error).message,
              stderr,
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

  // tick0：立刻执行一次
  execute();

  // 后续：cron 每 N 分钟触发
  const cronExpr = `*/${intervalMinutes} * * * *`;
  cron = new Cron(cronExpr, execute);

  // 信号处理：优雅收尾
  const shutdown = (sig: string) => {
    log("info", `received ${sig}, stopping`);
    cron?.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
