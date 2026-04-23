import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TodoStore } from "../src/store.js";
import { _resetDebugCache } from "../src/utils/debug-log.js";
import type { TodoItem } from "../src/types.js";

describe("store debug-log smoke", () => {
  let tmpDir: string;
  let originalCwd: string;
  let store: TodoStore;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-store-debug-"));
    fs.mkdirSync(path.join(tmpDir, ".harness"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".harness", "config.json"),
      JSON.stringify({ debug: true })
    );
    process.chdir(tmpDir);
    _resetDebugCache();
    store = new TodoStore(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _resetDebugCache();
  });

  const makeTodo = (overrides: Partial<TodoItem> = {}): TodoItem => ({
    id: "smoke-1",
    title: "Smoke",
    description: "desc",
    status: "pending",
    tmuxSessionId: "",
    remoteControlUrl: "",
    claudeSessionId: "",
    claudeSessionName: "",
    firstMessageSent: false,
    ...overrides,
  });

  const readLines = (): Record<string, unknown>[] =>
    fs
      .readFileSync(path.join(tmpDir, ".harness", "debug.log"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

  it("add emits store/add with todo context", () => {
    store.add(makeTodo());
    const rec = readLines().find(
      (r) => r.module === "store" && r.event === "add"
    );
    expect(rec).toMatchObject({
      module: "store",
      event: "add",
      id: "smoke-1",
      title: "Smoke",
      status: "pending",
      total: 1,
    });
  });

  it("update emits store/update with keys + patch", () => {
    store.add(makeTodo());
    store.update("smoke-1", { status: "running", tmuxSessionId: "t-1" });
    const rec = readLines().find(
      (r) => r.module === "store" && r.event === "update"
    );
    expect(rec).toMatchObject({
      module: "store",
      event: "update",
      id: "smoke-1",
      keys: ["status", "tmuxSessionId"],
      patch: { status: "running", tmuxSessionId: "t-1" },
      prevStatus: "pending",
      nextStatus: "running",
    });
  });

  it("delete emits store/delete with totals", () => {
    store.add(makeTodo());
    store.delete("smoke-1");
    const rec = readLines().find(
      (r) => r.module === "store" && r.event === "delete"
    );
    expect(rec).toMatchObject({
      module: "store",
      event: "delete",
      id: "smoke-1",
      removed: 1,
      total: 0,
    });
  });
});
