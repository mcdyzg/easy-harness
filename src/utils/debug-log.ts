import fs from "node:fs";
import path from "node:path";

// 模块级缓存：首次调用解析 .harness/config.json 后永久保留
let cached: { enabled: boolean; logPath: string } | undefined;

function resolve(baseDir: string): { enabled: boolean; logPath: string } {
  if (cached) return cached;
  const configPath = path.join(baseDir, ".harness", "config.json");
  let enabled = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    enabled = cfg?.debug === true;
  } catch {
    // 配置不存在 / 解析失败 → 关
  }
  cached = { enabled, logPath: path.join(baseDir, ".harness", "debug.log") };
  return cached;
}

function needsQuote(s: string): boolean {
  return s.length === 0 || /[\s"=\\]/.test(s);
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return needsQuote(v) ? quote(v) : v;
  try {
    return JSON.stringify(v);
  } catch {
    return "<unserializable>";
  }
}

function formatKv(kv: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(kv)) {
    const v = kv[k];
    if (v === undefined) continue;
    parts.push(`${k}=${formatValue(v)}`);
  }
  return parts.join(" ");
}

export function debugLog(
  module: string,
  event: string,
  kv?: Record<string, unknown>
): void {
  const { enabled, logPath } = resolve(process.cwd());
  if (!enabled) return;

  const ts = new Date().toISOString();
  const kvStr = kv ? " " + formatKv(kv) : "";
  const line = `[${ts}] [${module}] ${event}${kvStr}\n`;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line);
  } catch {
    // 写失败不影响主流程
  }
}

// 仅测试使用：清空缓存让下次调用重新读 config
export function _resetDebugCache(): void {
  cached = undefined;
}
