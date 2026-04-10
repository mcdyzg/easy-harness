import { describe, it, expect } from "vitest";
import {
  buildCreateSessionCommand,
  buildSendKeysCommand,
  buildClaudeCommand,
  parseTmuxSessionId,
} from "../../src/services/tmux.js";

describe("tmux command builders", () => {
  it("builds create session command", () => {
    const cmd = buildCreateSessionCommand({
      sessionName: "harness-abc123",
      claudeCommand: `claude -n '[HARNESS_SESSION]Fix login bug' --remote-control '当前任务信息是：修复登录页面的bug；当前待办项的id是abc123'`,
    });
    expect(cmd).toContain("tmux new-session -d");
    expect(cmd).toContain("-s harness-abc123");
    expect(cmd).toContain("claude -n");
    expect(cmd).toContain("--remote-control");
  });

  it("builds send-keys command", () => {
    const cmd = buildSendKeysCommand("harness-abc123", "请帮我修复这个bug");
    expect(cmd).toContain("tmux send-keys");
    expect(cmd).toContain("-t harness-abc123");
    expect(cmd).toContain("Enter");
  });

  it("parses tmux session id from list output", () => {
    const output = "harness-abc123: 1 windows (created Wed Apr  9 10:00:00 2026)";
    const id = parseTmuxSessionId(output, "harness-abc123");
    expect(id).toBe("harness-abc123");
  });

  it("returns undefined when session not found", () => {
    const output = "other-session: 1 windows (created Wed Apr  9 10:00:00 2026)";
    const id = parseTmuxSessionId(output, "harness-abc123");
    expect(id).toBeUndefined();
  });
});

describe("buildClaudeCommand", () => {
  it("builds claude launch command with all parameters", () => {
    const cmd = buildClaudeCommand({
      sessionName: "[HARNESS_SESSION]Fix login bug",
      todoId: "abc123",
      description: "修复登录页面的bug",
    });
    expect(cmd).toContain("claude -n");
    expect(cmd).toContain("[HARNESS_SESSION]Fix login bug");
    expect(cmd).toContain("--remote-control");
    expect(cmd).toContain("abc123");
    expect(cmd).toContain("修复登录页面的bug");
  });
});
