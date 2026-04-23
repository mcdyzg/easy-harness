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

  const readLog = () =>
    fs.readFileSync(path.join(tmpDir, ".harness", "debug.log"), "utf-8");

  it("add emits [store] add", () => {
    store.add(makeTodo());
    expect(readLog()).toMatch(/\[store\] add id=smoke-1/);
  });

  it("update emits [store] update with keys list", () => {
    store.add(makeTodo());
    store.update("smoke-1", { status: "running", tmuxSessionId: "t-1" });
    expect(readLog()).toMatch(/\[store\] update id=smoke-1 keys=\["status","tmuxSessionId"\]/);
  });

  it("delete emits [store] delete", () => {
    store.add(makeTodo());
    store.delete("smoke-1");
    expect(readLog()).toMatch(/\[store\] delete id=smoke-1/);
  });
});
