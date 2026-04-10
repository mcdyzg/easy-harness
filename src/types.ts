export type TodoStatus = "pending" | "running" | "done" | "failed";

export interface TodoItem {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  tmuxSessionId: string;
  remoteControlUrl: string;
  claudeSessionId: string;
  claudeSessionName: string;
}

export interface NoticeMessage {
  title: string;
  status: string;
  summary: string;
  tmuxSessionId: string;
  remoteControlUrl: string;
}

export interface MessageSender {
  send(message: NoticeMessage): Promise<void>;
}
