import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { debugLog } from "../utils/debug-log.js";

interface CommandHook {
  type: "command";
  command: string;
}

interface SkillHook {
  type: "skill";
  /** 兼容 skill 和 command 两种写法 */
  skill?: string;
  command?: string;
}

type HookConfig = CommandHook | SkillHook;

/**
 * 兼容两种 config 格式：
 * 扁平: [{ type, command/skill }]
 * 嵌套: [{ hooks: [{ type, command/skill }] }]（与 Claude Code hooks.json 格式一致）
 */
interface HarnessConfig {
  hooks?: Record<string, (HookConfig | { hooks: HookConfig[] })[]>;
}

/**
 * 读取 .harness/config.json，顺序执行指定事件的所有 hook
 */
export async function runHooks(
  baseDir: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const configPath = path.join(baseDir, ".harness", "config.json");
  if (!fs.existsSync(configPath)) return;

  let config: HarnessConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return;
  }

  const rawHooks = config.hooks?.[event];
  if (!rawHooks || rawHooks.length === 0) return;

  // 展平嵌套格式：{ hooks: [...] } → 内部数组
  const hooks: HookConfig[] = rawHooks.flatMap((item) =>
    "hooks" in item && Array.isArray((item as { hooks: HookConfig[] }).hooks)
      ? (item as { hooks: HookConfig[] }).hooks
      : [item as HookConfig]
  );

  debugLog("hooks", "event-dispatch", {
    baseDir,
    configPath,
    event,
    hookCount: hooks.length,
    payloadKeys: Object.keys(payload),
    payload,
  });

  const payloadJson = JSON.stringify(payload);

  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i];
    const start = Date.now();
    try {
      if (hook.type === "command") {
        debugLog("hooks", "hook-exec", {
          event,
          index: i,
          type: "command",
          detail: hook.command,
          command: hook.command,
          payloadBytes: Buffer.byteLength(payloadJson, "utf-8"),
        });
        execSync(hook.command, {
          input: payloadJson,
          stdio: ["pipe", "pipe", "pipe"],
        });
        debugLog("hooks", "hook-ok", {
          event,
          index: i,
          type: "command",
          durationMs: Date.now() - start,
        });
      } else if (hook.type === "skill") {
        const skillName = hook.skill || hook.command;
        if (!skillName) continue;
        const escaped = payloadJson.replace(/'/g, "'\\''");
        const skillCmd = `claude -p '调用 ${skillName} skill，参数：${escaped}'`;
        debugLog("hooks", "hook-exec", {
          event,
          index: i,
          type: "skill",
          detail: skillName,
          skill: skillName,
          command: skillCmd,
          payloadBytes: Buffer.byteLength(payloadJson, "utf-8"),
        });
        execSync(skillCmd, {
          stdio: ["pipe", "pipe", "pipe"],
        });
        debugLog("hooks", "hook-ok", {
          event,
          index: i,
          type: "skill",
          skill: skillName,
          durationMs: Date.now() - start,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errAny = err as { stderr?: Buffer | string; status?: number };
      const stderr = errAny?.stderr
        ? typeof errAny.stderr === "string"
          ? errAny.stderr
          : errAny.stderr.toString("utf-8")
        : undefined;
      debugLog("hooks", "hook-fail", {
        event,
        index: i,
        type: hook.type,
        durationMs: Date.now() - start,
        exitCode: errAny?.status,
        error: msg,
        stderr,
      });
      console.error(`[harness-hooks] ${event} hook 执行失败: ${msg}`);
    }
  }
}

/**
 * 判断指定事件是否有 hook 配置（展平后数量 > 0）
 * 单独抽出来供调用方在执行前决定是否走 fallback 路径
 */
export function hasConfiguredHooks(baseDir: string, event: string): boolean {
  const configPath = path.join(baseDir, ".harness", "config.json");
  if (!fs.existsSync(configPath)) return false;
  let config: HarnessConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return false;
  }
  const rawHooks = config.hooks?.[event];
  if (!rawHooks || rawHooks.length === 0) return false;
  const hooks = rawHooks.flatMap((item) =>
    "hooks" in item && Array.isArray((item as { hooks: HookConfig[] }).hooks)
      ? (item as { hooks: HookConfig[] }).hooks
      : [item as HookConfig]
  );
  return hooks.length > 0;
}
