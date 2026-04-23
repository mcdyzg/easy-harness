import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { debugLog, _resetDebugCache } from "../../src/utils/debug-log.js";

describe("debugLog (JSONL)", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-debug-log-test-"));
    fs.mkdirSync(path.join(tmpDir, ".harness"), { recursive: true });
    process.chdir(tmpDir);
    _resetDebugCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const logPath = () => path.join(tmpDir, ".harness", "debug.log");
  const writeConfig = (cfg: unknown) =>
    fs.writeFileSync(path.join(tmpDir, ".harness", "config.json"), JSON.stringify(cfg));
  const readLines = (): Record<string, unknown>[] =>
    fs
      .readFileSync(logPath(), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

  it("disabled when config missing", () => {
    debugLog("mod", "evt");
    expect(fs.existsSync(logPath())).toBe(false);
  });

  it("disabled when debug=false", () => {
    writeConfig({ debug: false });
    debugLog("mod", "evt");
    expect(fs.existsSync(logPath())).toBe(false);
  });

  it("disabled when debug field absent", () => {
    writeConfig({ hooks: {} });
    debugLog("mod", "evt");
    expect(fs.existsSync(logPath())).toBe(false);
  });

  it("disabled when debug is truthy but not strictly true", () => {
    writeConfig({ debug: 1 });
    debugLog("mod", "evt");
    expect(fs.existsSync(logPath())).toBe(false);
  });

  it("enabled when debug=true writes one valid JSON line", () => {
    writeConfig({ debug: true });
    debugLog("mod", "evt");
    const content = fs.readFileSync(logPath(), "utf-8");
    expect(content.endsWith("\n")).toBe(true);
    const rec = JSON.parse(content.trim());
    expect(rec.module).toBe("mod");
    expect(rec.event).toBe("evt");
    expect(typeof rec.ts).toBe("string");
    expect(rec.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof rec.pid).toBe("number");
  });

  it("appends rather than overwrites", () => {
    writeConfig({ debug: true });
    debugLog("mod", "a");
    debugLog("mod", "b");
    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]?.event).toBe("a");
    expect(lines[1]?.event).toBe("b");
  });

  it("creates .harness/ directory if missing before first write", () => {
    writeConfig({ debug: true });
    _resetDebugCache();
    debugLog("mod", "evt");
    fs.rmSync(path.join(tmpDir, ".harness"), { recursive: true, force: true });
    debugLog("mod", "evt2");
    expect(fs.existsSync(logPath())).toBe(true);
  });

  it("kv: string value survives as-is", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: "a b" });
    expect(readLines()[0]).toMatchObject({ a: "a b" });
  });

  it("kv: string with quote survives", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: 'x"y' });
    expect(readLines()[0]).toMatchObject({ a: 'x"y' });
  });

  it("kv: empty string preserved", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: "" });
    expect(readLines()[0]).toMatchObject({ a: "" });
  });

  it("kv: number and boolean preserved", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { n: 42, b: true });
    expect(readLines()[0]).toMatchObject({ n: 42, b: true });
  });

  it("kv: undefined is skipped", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: 1, b: undefined, c: 2 });
    const rec = readLines()[0];
    expect(rec).toMatchObject({ a: 1, c: 2 });
    expect(Object.hasOwn(rec, "b")).toBe(false);
  });

  it("kv: null preserved", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: null });
    expect(readLines()[0]).toMatchObject({ a: null });
  });

  it("kv: nested object preserved", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: { x: 1 } });
    expect(readLines()[0]).toMatchObject({ a: { x: 1 } });
  });

  it("kv: array preserved", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: [1, 2] });
    expect(readLines()[0]).toMatchObject({ a: [1, 2] });
  });

  it("kv: circular reference yields <unserializable>", () => {
    writeConfig({ debug: true });
    const o: Record<string, unknown> = {};
    o.self = o;
    debugLog("m", "e", { a: o });
    expect(readLines()[0]).toMatchObject({ a: "<unserializable>" });
  });

  it("kv: reserved top-level keys (ts/pid/module/event) are prefixed with _", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { ts: "custom-ts", pid: 999, module: "x", event: "y", ok: true });
    const rec = readLines()[0];
    expect(rec.module).toBe("m");
    expect(rec.event).toBe("e");
    expect(rec._ts).toBe("custom-ts");
    expect(rec._pid).toBe(999);
    expect(rec._module).toBe("x");
    expect(rec._event).toBe("y");
    expect(rec.ok).toBe(true);
  });

  it("survives appendFileSync throwing", () => {
    writeConfig({ debug: true });
    _resetDebugCache();
    const spy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("EACCES");
    });
    expect(() => debugLog("m", "e")).not.toThrow();
    spy.mockRestore();
  });

  it("caches config — reads config.json only once", () => {
    writeConfig({ debug: true });
    _resetDebugCache();
    const spy = vi.spyOn(fs, "readFileSync");
    debugLog("m", "a");
    debugLog("m", "b");
    debugLog("m", "c");
    const configReads = spy.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).endsWith("config.json")
    );
    expect(configReads).toHaveLength(1);
    spy.mockRestore();
  });
});
