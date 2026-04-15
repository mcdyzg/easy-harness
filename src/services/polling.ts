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
