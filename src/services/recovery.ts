import type { TodoItem } from "../types.js";
import { buildClaudeCommand, buildCreateSessionCommand } from "./tmux.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TodoStore } from "../store.js";
import { debugLog } from "../utils/debug-log.js";

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
  const inner = `claude -n '${todo.claudeSessionName}' --resume ${todo.claudeSessionId} --remote-control`;
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
  debugLog("recovery", "enter", {
    cwd,
    todoId: todo.id,
    title: todo.title,
    status: todo.status,
    tmuxSessionId: todo.tmuxSessionId,
    claudeSessionId: todo.claudeSessionId,
    aliveNow,
    action,
  });
  if (action === "noop") return;

  if (action === "resume") {
    const cmd = buildResumeCommand(todo);
    debugLog("recovery", "resume-try", { todoId: todo.id, cmd });
    const start = Date.now();
    try {
      deps.exec(cmd);
    } catch (e) {
      lastExecError = (e as Error).message;
    }
    deps.sleep(2000);
    if (deps.sessionExists(todo.tmuxSessionId)) {
      // --remote-control 会为 resumed session 生成新 URL，抓取并回写
      const pane = deps.capturePane(todo.tmuxSessionId);
      const url = parseRemoteControlUrl(pane);
      if (url) {
        deps.updateTodo(todo.id, { remoteControlUrl: url });
      }
      debugLog("recovery", "resume-ok", {
        todoId: todo.id,
        tmuxSessionId: todo.tmuxSessionId,
        urlCaptured: !!url,
        url,
        durationMs: Date.now() - start,
      });
      deps.log(
        `${new Date().toISOString()} todo=${todo.id} branch=A result=ok`
      );
      return;
    }
    debugLog("recovery", "resume-fail", {
      todoId: todo.id,
      tmuxSessionId: todo.tmuxSessionId,
      cmd,
      durationMs: Date.now() - start,
      error: lastExecError,
    });
    deps.log(
      `${new Date().toISOString()} todo=${todo.id} branch=A result=failed, falling back to B`
    );
  }

  // 分支 B（action === "fresh" 或 A 退化）
  lastExecError = "";
  const freshCmd = buildFreshSpawnCommand(todo);
  debugLog("recovery", "fresh-try", { todoId: todo.id, cmd: freshCmd });
  const freshStart = Date.now();
  try {
    deps.exec(freshCmd);
  } catch (e) {
    lastExecError = (e as Error).message;
  }
  deps.sleep(2000);
  if (!deps.sessionExists(todo.tmuxSessionId)) {
    const detail = lastExecError ? `: ${lastExecError}` : "";
    debugLog("recovery", "fresh-fail", {
      todoId: todo.id,
      tmuxSessionId: todo.tmuxSessionId,
      cmd: freshCmd,
      durationMs: Date.now() - freshStart,
      error: lastExecError,
    });
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

  debugLog("recovery", "fresh-ok", {
    todoId: todo.id,
    tmuxSessionId: todo.tmuxSessionId,
    urlCaptured: !!url,
    url,
    durationMs: Date.now() - freshStart,
  });
  deps.log(`${new Date().toISOString()} todo=${todo.id} branch=B result=ok`);
}

export function createDefaultDeps(cwd: string): RecoveryDeps {
  const store = new TodoStore(cwd);
  const logPath = path.join(
    process.env.CLAUDE_PLUGIN_ROOT ?? cwd,
    "log",
    "recovery.log"
  );
  return {
    sessionExists: (name) => {
      if (!name) return false;
      try {
        execSync(`tmux has-session -t ${JSON.stringify(name)} 2>/dev/null`, {
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    },
    exec: (cmd) => {
      execSync(cmd, { stdio: "pipe" });
    },
    capturePane: (name) => {
      try {
        return execSync(`tmux capture-pane -t ${JSON.stringify(name)} -p`, {
          encoding: "utf-8",
        });
      } catch {
        return "";
      }
    },
    sleep: (ms) => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    },
    updateTodo: (id, patch) => {
      store.update(id, patch);
    },
    log: (line) => {
      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, line + "\n");
      } catch {
        // 日志失败不影响主流程
      }
    },
  };
}
