import { describe, it, expect } from "vitest";
import { decideRecoveryAction, buildResumeCommand, buildFreshSpawnCommand, parseRemoteControlUrl, ensureSessionAlive } from "../../src/services/recovery.js";
import type { TodoItem } from "../../src/types.js";
import type { RecoveryDeps } from "../../src/services/recovery.js";

const mkTodo = (overrides: Partial<TodoItem> = {}): TodoItem => ({
  id: "abc",
  title: "t",
  description: "d",
  status: "running",
  tmuxSessionId: "harness-abc",
  remoteControlUrl: "",
  claudeSessionId: "session_xxx",
  claudeSessionName: "[HARNESS_SESSION]t",
  firstMessageSent: false,
  ...overrides,
});

describe("decideRecoveryAction", () => {
  it("tmux 活着 → noop", () => {
    expect(decideRecoveryAction(mkTodo(), true)).toBe("noop");
  });

  it("status 非 running → noop", () => {
    expect(decideRecoveryAction(mkTodo({ status: "pending" }), false)).toBe("noop");
    expect(decideRecoveryAction(mkTodo({ status: "done" }), false)).toBe("noop");
    expect(decideRecoveryAction(mkTodo({ status: "failed" }), false)).toBe("noop");
  });

  it("running + 挂 + 有 claudeSessionId → resume", () => {
    expect(decideRecoveryAction(mkTodo(), false)).toBe("resume");
  });

  it("running + 挂 + 无 claudeSessionId → fresh", () => {
    expect(decideRecoveryAction(mkTodo({ claudeSessionId: "" }), false)).toBe("fresh");
  });
});

describe("buildResumeCommand", () => {
  it("构造 tmux new-session + claude --resume 命令（不带 --remote-control）", () => {
    const todo = mkTodo({
      tmuxSessionId: "harness-abc",
      claudeSessionId: "session_xxx",
      claudeSessionName: "[HARNESS_SESSION]t",
    });
    const cmd = buildResumeCommand(todo);
    expect(cmd).toContain("tmux new-session -d -s harness-abc");
    expect(cmd).toContain("claude -n '[HARNESS_SESSION]t'");
    expect(cmd).toContain("--resume session_xxx");
    expect(cmd).not.toContain("--remote-control");
  });
});

describe("buildFreshSpawnCommand", () => {
  it("调 buildClaudeCommand 组装 --remote-control 提示，用 todo 的 title/description/id", () => {
    const todo = mkTodo({
      id: "abc",
      title: "修复登录 bug",
      description: "登录按钮点击无反应",
      tmuxSessionId: "harness-abc",
      claudeSessionName: "[HARNESS_SESSION]修复登录 bug",
    });
    const cmd = buildFreshSpawnCommand(todo);
    expect(cmd).toContain("tmux new-session -d -s harness-abc");
    expect(cmd).toContain("--remote-control");
    expect(cmd).toContain("修复登录 bug");
    expect(cmd).toContain("登录按钮点击无反应");
    expect(cmd).toContain("abc");
  });
});

describe("parseRemoteControlUrl", () => {
  it("从多行输出中提取 claude.ai/code/session_... URL", () => {
    const pane = `Welcome to Claude Code
Session started
Remote control: https://claude.ai/code/session_abc123def
Ready.`;
    expect(parseRemoteControlUrl(pane)).toBe(
      "https://claude.ai/code/session_abc123def"
    );
  });

  it("没匹配到时返回 undefined", () => {
    expect(parseRemoteControlUrl("no url here")).toBeUndefined();
    expect(parseRemoteControlUrl("")).toBeUndefined();
  });

  it("取第一条匹配", () => {
    const pane = `https://claude.ai/code/session_first
https://claude.ai/code/session_second`;
    expect(parseRemoteControlUrl(pane)).toBe(
      "https://claude.ai/code/session_first"
    );
  });
});

function makeDeps(overrides: Partial<RecoveryDeps> = {}): {
  deps: RecoveryDeps;
  calls: string[];
  updates: Record<string, Partial<TodoItem>>;
} {
  const calls: string[] = [];
  const updates: Record<string, Partial<TodoItem>> = {};
  // 若 override 提供了 sessionExists，包一层以保留 calls 追踪
  const sessionExistsImpl = overrides.sessionExists
    ? (name: string) => {
        calls.push(`has:${name}`);
        return (overrides.sessionExists as RecoveryDeps["sessionExists"])(name);
      }
    : (name: string) => {
        calls.push(`has:${name}`);
        return false;
      };
  const { sessionExists: _ignored, ...restOverrides } = overrides;
  const deps: RecoveryDeps = {
    sessionExists: sessionExistsImpl,
    exec: (cmd) => {
      calls.push(`exec:${cmd}`);
    },
    capturePane: () => {
      calls.push(`capture`);
      return "https://claude.ai/code/session_new";
    },
    sleep: () => {
      calls.push("sleep");
    },
    updateTodo: (id, patch) => {
      calls.push(`update:${id}`);
      updates[id] = { ...(updates[id] ?? {}), ...patch };
    },
    log: () => {
      calls.push("log");
    },
    ...restOverrides,
  };
  return { deps, calls, updates };
}

describe("ensureSessionAlive", () => {
  const runningTodo = mkTodo();

  it("tmux 活着 → 只调一次 has-session 就返回", () => {
    const { deps, calls } = makeDeps({
      sessionExists: () => true,
    });
    ensureSessionAlive("/cwd", runningTodo, deps);
    expect(calls.filter((c) => c.startsWith("exec:")).length).toBe(0);
    expect(calls.some((c) => c.startsWith("has:"))).toBe(true);
  });

  it("status 非 running → 不做恢复", () => {
    const { deps, calls } = makeDeps();
    ensureSessionAlive("/cwd", mkTodo({ status: "done" }), deps);
    expect(calls.filter((c) => c.startsWith("exec:")).length).toBe(0);
  });

  it("有 claudeSessionId → 跑 resume 命令，不抓 URL，不改 firstMessageSent", () => {
    let callNo = 0;
    const { deps, calls, updates } = makeDeps({
      sessionExists: () => {
        callNo++;
        return callNo >= 2;
      },
    });
    ensureSessionAlive("/cwd", runningTodo, deps);
    const execCalls = calls.filter((c) => c.startsWith("exec:"));
    expect(execCalls.length).toBe(1);
    expect(execCalls[0]).toContain("--resume session_xxx");
    expect(execCalls[0]).not.toContain("--remote-control");
    expect(calls).not.toContain("capture");
    expect(updates["abc"]).toBeUndefined();
  });

  it("无 claudeSessionId → 跑 fresh 命令，抓 URL，重置 firstMessageSent", () => {
    let callNo = 0;
    const { deps, calls, updates } = makeDeps({
      sessionExists: () => {
        callNo++;
        return callNo >= 2;
      },
    });
    const todo = mkTodo({
      claudeSessionId: "",
      firstMessageSent: true,
    });
    ensureSessionAlive("/cwd", todo, deps);
    const execCalls = calls.filter((c) => c.startsWith("exec:"));
    expect(execCalls.length).toBe(1);
    expect(execCalls[0]).toContain("--remote-control");
    expect(updates["abc"]).toEqual({
      remoteControlUrl: "https://claude.ai/code/session_new",
      firstMessageSent: false,
    });
  });

  it("分支 A resume 启动失败（第二次 has-session 仍然 false）→ 退化到分支 B", () => {
    // has 调用序列：1st false（初始挂）、2nd false（resume 后仍挂，触发退化）、3rd true（B 起来了）
    let callNo = 0;
    const { deps, calls, updates } = makeDeps({
      sessionExists: () => {
        callNo++;
        return callNo >= 3;
      },
    });
    ensureSessionAlive("/cwd", runningTodo, deps);
    const execCalls = calls.filter((c) => c.startsWith("exec:"));
    expect(execCalls.length).toBe(2);
    expect(execCalls[0]).toContain("--resume");
    expect(execCalls[1]).toContain("--remote-control");
    expect(updates["abc"]).toMatchObject({ firstMessageSent: false });
  });

  it("两个分支都失败 → 抛错", () => {
    const { deps } = makeDeps({
      sessionExists: () => false,
    });
    expect(() => ensureSessionAlive("/cwd", runningTodo, deps)).toThrow(
      /recover/i
    );
  });

  it("恢复失败时，抛出的 Error 里带上 exec 的错误信息", () => {
    const { deps } = makeDeps({
      sessionExists: () => false,
      exec: () => {
        throw new Error("tmux: command not found");
      },
    });
    expect(() => ensureSessionAlive("/cwd", runningTodo, deps)).toThrow(
      /tmux: command not found/
    );
  });
});
