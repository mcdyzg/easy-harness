import type { TodoItem } from "../types.js";
import { buildClaudeCommand, buildCreateSessionCommand } from "./tmux.js";

export type RecoveryAction = "noop" | "resume" | "fresh";

export function decideRecoveryAction(
  todo: TodoItem,
  sessionAlive: boolean
): RecoveryAction {
  if (sessionAlive) return "noop";
  if (todo.status !== "running") return "noop";
  if (todo.claudeSessionId) return "resume";
  return "fresh";
}

export function buildResumeCommand(todo: TodoItem): string {
  const inner = `claude -n '${todo.claudeSessionName}' --resume ${todo.claudeSessionId}`;
  return `tmux new-session -d -s ${todo.tmuxSessionId} "${inner}"`;
}

export function buildFreshSpawnCommand(todo: TodoItem): string {
  const claudeCommand = buildClaudeCommand({
    sessionName: todo.claudeSessionName,
    todoId: todo.id,
    title: todo.title,
    description: todo.description,
  });
  return buildCreateSessionCommand({
    sessionName: todo.tmuxSessionId,
    claudeCommand,
  });
}

export function parseRemoteControlUrl(paneOutput: string): string | undefined {
  const match = paneOutput.match(/https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/);
  return match?.[0];
}
