import { execSync } from "node:child_process";
import { debugLog } from "../utils/debug-log.js";

export interface CreateSessionOptions {
  sessionName: string;
  claudeCommand: string;
}

export interface ClaudeCommandOptions {
  sessionName: string;
  todoId: string;
  title: string;
  description: string;
}

export function buildClaudeCommand(options: ClaudeCommandOptions): string {
  const { sessionName, todoId, title, description } = options;
  const prompt = `当前被分配了以下任务：\n- 标题：${title}\n- 描述：${description}\n后续根据用户指令完成任务。待办项的id是${todoId}`;
  return `claude -n '${sessionName}' --remote-control '${prompt}'`;
}

export function buildCreateSessionCommand(options: CreateSessionOptions): string {
  const { sessionName, claudeCommand } = options;
  return `tmux new-session -d -s ${sessionName} "${claudeCommand}"`;
}

export function buildSendKeysCommand(sessionName: string, text: string): string {
  const escaped = text.replace(/'/g, "'\\''");
  // 内容和 Enter 一起发会导致某些场景下（如较长的单行文本）无法提交，
  // 拆成两次：先发内容，sleep 0.3s 让终端处理完，再发 Enter
  return `tmux send-keys -t ${sessionName} '${escaped}' && sleep 0.3 && tmux send-keys -t ${sessionName} Enter`;
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
  debugLog("tmux", "exec", { cmd });
  try {
    execSync(cmd);
    debugLog("tmux", "exec-ok", { cmd });
  } catch (e) {
    debugLog("tmux", "exec-fail", { cmd, error: (e as Error).message });
    throw e;
  }
}

export function sendKeysToSession(sessionName: string, text: string): void {
  const cmd = buildSendKeysCommand(sessionName, text);
  debugLog("tmux", "exec", { cmd });
  try {
    execSync(cmd);
    debugLog("tmux", "exec-ok", { cmd });
  } catch (e) {
    debugLog("tmux", "exec-fail", { cmd, error: (e as Error).message });
    throw e;
  }
}
