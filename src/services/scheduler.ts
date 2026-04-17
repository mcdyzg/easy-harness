import { Cron } from "croner";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ScheduleItem } from "../types.js";

export interface ValidationResult {
  valid: ScheduleItem[];
  warnings: string[];
}

export function validateSchedules(items: unknown[]): ValidationResult {
  const valid: ScheduleItem[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const s = item as Record<string, unknown>;
    const name = String(s.name ?? "");

    if (seen.has(name)) {
      warnings.push(`重复的 name "${name}"，跳过`);
      continue;
    }
    seen.add(name);

    // 校验 cron
    try {
      new Cron(String(s.cron ?? ""), { paused: true });
    } catch {
      warnings.push(`[${name}] cron 表达式非法: "${s.cron}"`);
      continue;
    }

    // 校验 type + 必填字段
    if (s.type === "skill") {
      if (!s.skill || typeof s.skill !== "string") {
        warnings.push(`[${name}] type=skill 但缺少 skill 字段`);
        continue;
      }
      valid.push({ name, cron: String(s.cron), type: "skill", skill: s.skill });
    } else if (s.type === "command") {
      if (!s.command || typeof s.command !== "string") {
        warnings.push(`[${name}] type=command 但缺少 command 字段`);
        continue;
      }
      valid.push({ name, cron: String(s.cron), type: "command", command: s.command });
    } else {
      warnings.push(`[${name}] 未知 type: "${s.type}"`);
    }
  }

  return { valid, warnings };
}

export interface ExecuteResult {
  ok: boolean;
  error?: string;
  durationMs?: number;
}

export function loadSchedulesFromConfig(baseDir: string): ValidationResult {
  const configPath = path.join(baseDir, ".harness", "config.json");
  if (!fs.existsSync(configPath)) {
    return { valid: [], warnings: [] };
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return { valid: [], warnings: ["config.json 解析失败"] };
  }

  const schedules = config.schedules;
  if (!schedules) {
    return { valid: [], warnings: [] };
  }
  if (!Array.isArray(schedules)) {
    return { valid: [], warnings: ["schedules 字段不是数组"] };
  }

  return validateSchedules(schedules);
}

export function executeSchedule(item: ScheduleItem, cwd: string): ExecuteResult {
  const start = Date.now();
  try {
    if (item.type === "command") {
      execSync(item.command, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    } else {
      const escaped = item.skill.replace(/'/g, "'\\''");
      execSync(`claude -p '调用 ${escaped} skill'`, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    }
    return { ok: true, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, durationMs: Date.now() - start };
  }
}
