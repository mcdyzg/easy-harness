import { describe, it, expect } from "vitest";
import { buildFirstMessage } from "../../src/services/message.js";
import type { TodoItem } from "../../src/types.js";

const makeTodo = (overrides: Partial<TodoItem> = {}): TodoItem => ({
  id: "abc123def456",
  title: "实现登录功能",
  description: "使用 JWT 实现用户登录注册",
  status: "running",
  tmuxSessionId: "harness-abc123def456",
  remoteControlUrl: "",
  claudeSessionId: "",
  claudeSessionName: "[HARNESS_SESSION]实现登录功能",
  firstMessageSent: false,
  ...overrides,
});

describe("buildFirstMessage", () => {
  it("首次消息拼接上下文前缀", () => {
    const todo = makeTodo({ firstMessageSent: false });
    const result = buildFirstMessage(todo, "开始执行");

    expect(result).toContain("【待办项上下文】");
    expect(result).toContain("- 标题：实现登录功能");
    expect(result).toContain("- 描述：使用 JWT 实现用户登录注册");
    expect(result).toContain("- 待办项 ID：abc123def456");
    expect(result).toContain("以下是用户指令：");
    expect(result).toContain("开始执行");
  });

  it("非首次消息直接透传", () => {
    const todo = makeTodo({ firstMessageSent: true });
    const result = buildFirstMessage(todo, "继续执行下一步");

    expect(result).toBe("继续执行下一步");
  });

  it("firstMessageSent 为 undefined 时视为首次（向后兼容）", () => {
    const todo = makeTodo();
    // 模拟旧记录缺失该字段
    (todo as any).firstMessageSent = undefined;
    const result = buildFirstMessage(todo, "开始");

    expect(result).toContain("【待办项上下文】");
    expect(result).toContain("开始");
  });
});
