import { execSync } from "node:child_process";
import { Cron } from "croner";
import type { TodoItem } from "../types.js";
import { TodoStore } from "../store.js";
import { buildSendKeysCommand } from "./tmux.js";

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

  // cron 提前声明：execute() 在 tick0 路径可能早于 new Cron 就要引用它
  let cron: Cron | undefined;

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
