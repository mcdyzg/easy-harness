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
