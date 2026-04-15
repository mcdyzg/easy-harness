import { describe, it, expect } from "vitest";
import { initialState, tick } from "../../src/services/polling.js";
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
