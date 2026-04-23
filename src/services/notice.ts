import type { MessageSender, NoticeMessage } from "../types.js";

export function formatNoticeMessage(message: NoticeMessage): string {
  const lines = [
    `📋 ${message.title}`,
    `状态: ${message.status}`,
    `用户: ${message.userMessage}`,
    `助手: ${message.assistantMessage}`,
    `Tmux Session: ${message.tmuxSessionId}`,
    `Remote URL: ${message.remoteControlUrl}`,
  ];
  if (message.metadata && Object.keys(message.metadata).length > 0) {
    lines.push("关联:");
    for (const key of Object.keys(message.metadata).sort()) {
      lines.push(`  ${key}: ${message.metadata[key]}`);
    }
  }
  return lines.join("\n");
}

export class ConsoleMessageSender implements MessageSender {
  async send(message: NoticeMessage): Promise<void> {
    console.log(formatNoticeMessage(message));
  }
}
