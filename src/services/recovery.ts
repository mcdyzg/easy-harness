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

export interface RecoveryDeps {
  sessionExists: (tmuxSessionId: string) => boolean;
  exec: (cmd: string) => void;
  capturePane: (tmuxSessionId: string) => string;
  sleep: (ms: number) => void;
  updateTodo: (id: string, patch: Partial<TodoItem>) => void;
  log: (line: string) => void;
}

export function ensureSessionAlive(
  cwd: string,
  todo: TodoItem,
  deps: RecoveryDeps
): void {
  let lastExecError = "";

  const aliveNow = deps.sessionExists(todo.tmuxSessionId);
  const action = decideRecoveryAction(todo, aliveNow);
  if (action === "noop") return;

  if (action === "resume") {
    try {
      deps.exec(buildResumeCommand(todo));
    } catch (e) {
      lastExecError = (e as Error).message;
    }
    deps.sleep(2000);
    if (deps.sessionExists(todo.tmuxSessionId)) {
      deps.log(
        `${new Date().toISOString()} todo=${todo.id} branch=A result=ok`
      );
      return;
    }
    deps.log(
      `${new Date().toISOString()} todo=${todo.id} branch=A result=failed, falling back to B`
    );
  }

  // 分支 B（action === "fresh" 或 A 退化）
  try {
    deps.exec(buildFreshSpawnCommand(todo));
  } catch (e) {
    lastExecError = (e as Error).message;
  }
  deps.sleep(2000);
  if (!deps.sessionExists(todo.tmuxSessionId)) {
    const detail = lastExecError ? `: ${lastExecError}` : "";
    deps.log(
      `${new Date().toISOString()} todo=${todo.id} branch=B result=failed${detail}`
    );
    throw new Error(`failed to recover tmux session for todo ${todo.id}${detail}`);
  }

  const pane = deps.capturePane(todo.tmuxSessionId);
  const url = parseRemoteControlUrl(pane);
  const patch: Partial<TodoItem> = { firstMessageSent: false };
  if (url) patch.remoteControlUrl = url;
  deps.updateTodo(todo.id, patch);

  deps.log(`${new Date().toISOString()} todo=${todo.id} branch=B result=ok`);
}
