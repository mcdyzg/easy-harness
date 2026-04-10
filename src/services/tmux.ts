import { execSync } from "node:child_process";

export interface CreateSessionOptions {
  sessionName: string;
  claudeCommand: string;
}

export interface ClaudeCommandOptions {
  sessionName: string;
  todoId: string;
  description: string;
}

export function buildClaudeCommand(options: ClaudeCommandOptions): string {
  const { sessionName, todoId, description } = options;
  const prompt = `当前任务信息是：${description}；当前待办项的id是${todoId}`;
  return `claude -n '${sessionName}' --remote-control '${prompt}'`;
}

export function buildCreateSessionCommand(options: CreateSessionOptions): string {
  const { sessionName, claudeCommand } = options;
  return `tmux new-session -d -s ${sessionName} "${claudeCommand}"`;
}

export function buildSendKeysCommand(sessionName: string, text: string): string {
  const escaped = text.replace(/'/g, "'\\''");
  return `tmux send-keys -t ${sessionName} '${escaped}' Enter`;
}

export function parseTmuxSessionId(
  listOutput: string,
  sessionName: string
): string | undefined {
  const lines = listOutput.split("\n");
  for (const line of lines) {
    if (line.startsWith(`${sessionName}:`)) {
      return sessionName;
    }
  }
  return undefined;
}

export function createTmuxSession(options: CreateSessionOptions): void {
  const cmd = buildCreateSessionCommand(options);
  execSync(cmd);
}

export function sendKeysToSession(sessionName: string, text: string): void {
  const cmd = buildSendKeysCommand(sessionName, text);
  execSync(cmd);
}
