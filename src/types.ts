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
  firstMessageSent: boolean;
  metadata?: Record<string, string>;
}

export interface NoticeMessage {
  title: string;
  status: string;
  userMessage: string;
  assistantMessage: string;
  tmuxSessionId: string;
  remoteControlUrl: string;
}

export interface MessageSender {
  send(message: NoticeMessage): Promise<void>;
}

interface ScheduleItemBase {
  name: string;
  cron: string;
}

export interface SkillSchedule extends ScheduleItemBase {
  type: "skill";
  skill: string;
  args?: string;
}

export interface CommandSchedule extends ScheduleItemBase {
  type: "command";
  command: string;
}

export type ScheduleItem = SkillSchedule | CommandSchedule;
