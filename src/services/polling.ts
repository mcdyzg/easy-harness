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
