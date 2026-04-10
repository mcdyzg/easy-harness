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
    summary: "已修复登录页面的表单验证问题",
    tmuxSessionId: "harness-abc123",
    remoteControlUrl: "http://localhost:3000/rc/abc",
  };

  it("formats message with all fields", () => {
    const text = formatNoticeMessage(message);
    expect(text).toContain("Fix login bug");
    expect(text).toContain("done");
    expect(text).toContain("已修复登录页面的表单验证问题");
    expect(text).toContain("harness-abc123");
    expect(text).toContain("http://localhost:3000/rc/abc");
  });
});

describe("ConsoleMessageSender", () => {
  it("implements MessageSender interface", async () => {
    const sender = new ConsoleMessageSender();
    // 不抛错即通过
    await sender.send({
      title: "Test",
      status: "done",
      summary: "test summary",
      tmuxSessionId: "tmux-1",
      remoteControlUrl: "http://localhost:3000",
    });
  });
});
