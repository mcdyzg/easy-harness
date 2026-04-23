import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { debugLog, _resetDebugCache } from "../../src/utils/debug-log.js";

describe("debugLog", () => {
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

  it("enabled when debug=true writes one line", () => {
    writeConfig({ debug: true });
    debugLog("mod", "evt");
    const content = fs.readFileSync(logPath(), "utf-8");
    expect(content).toMatch(/^\[[\d:T.Z-]+\] \[mod\] evt\n$/);
  });

  it("appends rather than overwrites", () => {
    writeConfig({ debug: true });
    debugLog("mod", "a");
    debugLog("mod", "b");
    const lines = fs.readFileSync(logPath(), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("] a");
    expect(lines[1]).toContain("] b");
  });

  it("creates .harness/ directory if missing before first write", () => {
    writeConfig({ debug: true });
    _resetDebugCache();
    debugLog("mod", "evt");
    fs.rmSync(path.join(tmpDir, ".harness"), { recursive: true, force: true });
    debugLog("mod", "evt2");
    expect(fs.existsSync(logPath())).toBe(true);
  });

  it("kv: simple string no quoting", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: "abc" });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e a=abc");
  });

  it("kv: string with space is quoted", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: "a b" });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain('e a="a b"');
  });

  it("kv: string with quote escaped", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: 'x"y' });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain('e a="x\\"y"');
  });

  it("kv: empty string is quoted", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: "" });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain('e a=""');
  });

  it("kv: number and boolean unquoted", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { n: 42, b: true });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e n=42 b=true");
  });

  it("kv: undefined is skipped", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: 1, b: undefined, c: 2 });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e a=1 c=2");
  });

  it("kv: null rendered as null", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: null });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e a=null");
  });

  it("kv: object serialized as JSON", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: { x: 1 } });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain('e a={"x":1}');
  });

  it("kv: array serialized as JSON", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { a: [1, 2] });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e a=[1,2]");
  });

  it("kv: circular reference yields <unserializable>", () => {
    writeConfig({ debug: true });
    const o: Record<string, unknown> = {};
    o.self = o;
    debugLog("m", "e", { a: o });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e a=<unserializable>");
  });

  it("kv: preserves insertion order", () => {
    writeConfig({ debug: true });
    debugLog("m", "e", { z: 1, a: 2, m: 3 });
    expect(fs.readFileSync(logPath(), "utf-8")).toContain("e z=1 a=2 m=3");
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
