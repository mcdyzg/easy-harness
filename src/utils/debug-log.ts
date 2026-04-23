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

// 兜底序列化：对循环引用等不可序列化值返回占位符
function safeClone(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return "<unserializable>";
  }
}

function buildRecord(
  module: string,
  event: string,
  kv?: Record<string, unknown>
): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    ts: new Date().toISOString(),
    pid: process.pid,
    module,
    event,
  };
  if (kv) {
    for (const k of Object.keys(kv)) {
      const v = kv[k];
      if (v === undefined) continue;
      // 避免顶层字段被 kv 覆盖
      if (k === "ts" || k === "pid" || k === "module" || k === "event") {
        rec[`_${k}`] = safeClone(v);
      } else {
        rec[k] = safeClone(v);
      }
    }
  }
  return rec;
}

export function debugLog(
  module: string,
  event: string,
  kv?: Record<string, unknown>
): void {
  const { enabled, logPath } = resolve(process.cwd());
  if (!enabled) return;

  const rec = buildRecord(module, event, kv);
  let line: string;
  try {
    line = JSON.stringify(rec) + "\n";
  } catch {
    // 极端兜底：即便 buildRecord 已做 safeClone，也再包一层
    line =
      JSON.stringify({
        ts: new Date().toISOString(),
        pid: process.pid,
        module,
        event,
        error: "<serialize-failed>",
      }) + "\n";
  }

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
