import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

interface CommandHook {
  type: "command";
  command: string;
}

interface SkillHook {
  type: "skill";
  skill: string;
}

type HookConfig = CommandHook | SkillHook;

interface HarnessConfig {
  hooks?: Record<string, HookConfig[]>;
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

  const hooks = config.hooks?.[event];
  if (!hooks || hooks.length === 0) return;

  const payloadJson = JSON.stringify(payload);

  for (const hook of hooks) {
    try {
      if (hook.type === "command") {
        execSync(hook.command, {
          input: payloadJson,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } else if (hook.type === "skill") {
        const escaped = payloadJson.replace(/'/g, "'\\''");
        execSync(`claude -p '调用 ${hook.skill} skill，参数：${escaped}'`, {
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[harness-hooks] ${event} hook 执行失败: ${msg}`);
    }
  }
}
