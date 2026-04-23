import { Cron } from "croner";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ScheduleItem, SkillSchedule } from "../types.js";
import { debugLog } from "../utils/debug-log.js";

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

    if (!name) {
      warnings.push(`schedule 缺少 name 字段，跳过`);
      continue;
    }
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
      const entry: SkillSchedule = {
        name,
        cron: String(s.cron),
        type: "skill",
        skill: s.skill,
      };
      if (typeof s.args === "string") entry.args = s.args;
      valid.push(entry);
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
      const skillEscaped = item.skill.replace(/'/g, "'\\''");
      const prompt = item.args
        ? `调用 ${skillEscaped} skill，参数：${item.args.replace(/'/g, "'\\''")}`
        : `调用 ${skillEscaped} skill`;
      execSync(`claude -p '${prompt}'`, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    }
    return { ok: true, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, durationMs: Date.now() - start };
  }
}

function log(level: "info" | "warn" | "error", msg: string): void {
  const line = `[${new Date().toISOString()}] ${level.padEnd(5)} ${msg}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

export interface RunSchedulerOptions {
  cwd: string;
}

export function runScheduler(opts: RunSchedulerOptions): void {
  const { cwd } = opts;
  const { valid, warnings } = loadSchedulesFromConfig(cwd);

  for (const w of warnings) {
    log("warn", w);
  }

  if (valid.length === 0) {
    log("info", "no valid schedules found, exiting");
    process.exit(0);
  }

  debugLog("scheduler", "start", { count: valid.length });
  log("info", `scheduler started: ${valid.length} schedules loaded`);
  for (const s of valid) {
    const detail = s.type === "skill" ? `skill: ${s.skill}` : `command: ${s.command}`;
    debugLog("scheduler", "schedule-loaded", {
      name: s.name,
      cron: s.cron,
      type: s.type,
      detail,
    });
    log("info", `  [${s.name}] cron="${s.cron}" (${detail})`);
  }

  const crons: Cron[] = [];

  for (const item of valid) {
    const job = new Cron(item.cron, () => {
      const detail = item.type === "skill" ? `skill: ${item.skill}` : `command: ${item.command}`;
      debugLog("scheduler", "fire", { name: item.name });
      log("info", `[${item.name}] triggered (${detail})`);

      const result = executeSchedule(item, cwd);

      if (result.ok) {
        debugLog("scheduler", "fire-ok", {
          name: item.name,
          durationMs: result.durationMs ?? 0,
        });
        log("info", `[${item.name}] completed (${result.durationMs}ms)`);
      } else {
        debugLog("scheduler", "fire-fail", {
          name: item.name,
          durationMs: result.durationMs ?? 0,
          error: result.error ?? "",
        });
        log("error", `[${item.name}] failed: ${result.error}`);
      }
    });
    crons.push(job);
  }

  const shutdown = (sig: string) => {
    log("info", `received ${sig}, stopping`);
    for (const c of crons) c.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
