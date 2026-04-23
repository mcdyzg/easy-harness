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

function extractStderr(e: unknown): string {
  const err = e as { stderr?: Buffer | string; message?: string };
  if (err?.stderr) {
    return typeof err.stderr === "string" ? err.stderr : err.stderr.toString("utf-8");
  }
  return err?.message ?? String(e);
}

export function createTmuxSession(options: CreateSessionOptions): void {
  const cmd = buildCreateSessionCommand(options);
  debugLog("tmux", "exec", {
    op: "create-session",
    sessionName: options.sessionName,
    claudeCommand: options.claudeCommand,
    cmd,
  });
  const start = Date.now();
  try {
    execSync(cmd);
    debugLog("tmux", "exec-ok", {
      op: "create-session",
      sessionName: options.sessionName,
      cmd,
      durationMs: Date.now() - start,
    });
  } catch (e) {
    debugLog("tmux", "exec-fail", {
      op: "create-session",
      sessionName: options.sessionName,
      cmd,
      durationMs: Date.now() - start,
      error: (e as Error).message,
      stderr: extractStderr(e),
    });
    throw e;
  }
}

export function sendKeysToSession(sessionName: string, text: string): void {
  const cmd = buildSendKeysCommand(sessionName, text);
  debugLog("tmux", "exec", {
    op: "send-keys",
    sessionName,
    textLen: text.length,
    textPreview: text.slice(0, 120),
    cmd,
  });
  const start = Date.now();
  try {
    execSync(cmd);
    debugLog("tmux", "exec-ok", {
      op: "send-keys",
      sessionName,
      cmd,
      durationMs: Date.now() - start,
    });
  } catch (e) {
    debugLog("tmux", "exec-fail", {
      op: "send-keys",
      sessionName,
      cmd,
      durationMs: Date.now() - start,
      error: (e as Error).message,
      stderr: extractStderr(e),
    });
    throw e;
  }
}
