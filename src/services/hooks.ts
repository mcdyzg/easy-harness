import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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

  const payloadJson = JSON.stringify(payload);

  for (const hook of hooks) {
    try {
      if (hook.type === "command") {
        execSync(hook.command, {
          input: payloadJson,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } else if (hook.type === "skill") {
        // 兼容 skill / command 两种属性名
        const skillName = hook.skill || hook.command;
        if (!skillName) continue;
        const escaped = payloadJson.replace(/'/g, "'\\''");
        execSync(`claude -p '调用 ${skillName} skill，参数：${escaped}'`, {
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[harness-hooks] ${event} hook 执行失败: ${msg}`);
    }
  }
}
