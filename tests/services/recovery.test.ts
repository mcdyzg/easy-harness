import { describe, it, expect } from "vitest";
import { decideRecoveryAction, buildResumeCommand, buildFreshSpawnCommand, parseRemoteControlUrl } from "../../src/services/recovery.js";
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
