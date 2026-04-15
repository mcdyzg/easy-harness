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
