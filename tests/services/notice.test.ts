import { describe, it, expect } from "vitest";
import {
  ConsoleMessageSender,
  formatNoticeMessage,
} from "../../src/services/notice.js";
import type { NoticeMessage } from "../../src/types.js";

describe("formatNoticeMessage", () => {
  const message: NoticeMessage = {
    title: "Fix login bug",
    status: "done",
    userMessage: "帮我修下登录页验证",
    assistantMessage: "已修复登录页面的表单验证问题",
    tmuxSessionId: "harness-abc123",
    remoteControlUrl: "http://localhost:3000/rc/abc",
  };

  it("formats message with all fields", () => {
    const text = formatNoticeMessage(message);
    expect(text).toContain("Fix login bug");
    expect(text).toContain("done");
    expect(text).toContain("帮我修下登录页验证");
    expect(text).toContain("已修复登录页面的表单验证问题");
    expect(text).toContain("harness-abc123");
    expect(text).toContain("http://localhost:3000/rc/abc");
  });

  it("renders metadata block when metadata is non-empty, sorted by key", () => {
    const out = formatNoticeMessage({
      ...message,
      metadata: { meego: "https://meego.feishu.cn/1", code: "https://github.com/x/y/pull/1" },
    });
    expect(out).toContain("关联:");
    // key 字母序：code 在 meego 之前
    const codeIdx = out.indexOf("  code: https://github.com/x/y/pull/1");
    const meegoIdx = out.indexOf("  meego: https://meego.feishu.cn/1");
    expect(codeIdx).toBeGreaterThan(-1);
    expect(meegoIdx).toBeGreaterThan(codeIdx);
  });

  it("omits metadata block when metadata is absent", () => {
    const out = formatNoticeMessage(message);
    expect(out).not.toContain("关联:");
  });

  it("omits metadata block when metadata is an empty object", () => {
    const out = formatNoticeMessage({ ...message, metadata: {} });
    expect(out).not.toContain("关联:");
  });
});

describe("ConsoleMessageSender", () => {
  it("implements MessageSender interface", async () => {
    const sender = new ConsoleMessageSender();
    // 不抛错即通过
    await sender.send({
      title: "Test",
      status: "done",
      userMessage: "test user message",
      assistantMessage: "test assistant message",
      tmuxSessionId: "tmux-1",
      remoteControlUrl: "http://localhost:3000",
    });
  });
});
