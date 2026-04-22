import type { TodoItem } from "../types.js";

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
