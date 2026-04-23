import type { MessageSender, NoticeMessage } from "../types.js";

export function formatNoticeMessage(message: NoticeMessage): string {
  return [
    `📋 ${message.title}`,
    `状态: ${message.status}`,
    `用户: ${message.userMessage}`,
    `助手: ${message.assistantMessage}`,
    `Tmux Session: ${message.tmuxSessionId}`,
    `Remote URL: ${message.remoteControlUrl}`,
  ].join("\n");
}

export class ConsoleMessageSender implements MessageSender {
  async send(message: NoticeMessage): Promise<void> {
    console.log(formatNoticeMessage(message));
  }
}
