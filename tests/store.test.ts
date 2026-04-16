import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TodoStore } from "../src/store.js";
import type { TodoItem } from "../src/types.js";

describe("TodoStore", () => {
  let tmpDir: string;
  let store: TodoStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
    store = new TodoStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeTodo = (overrides: Partial<TodoItem> = {}): TodoItem => ({
    id: "test-001",
    title: "Test Todo",
    description: "A test todo item",
    status: "pending",
    tmuxSessionId: "",
    remoteControlUrl: "",
    claudeSessionId: "",
    claudeSessionName: "",
    firstMessageSent: false,
    ...overrides,
  });

  it("creates .harness dir and todos.json on first write", () => {
    store.add(makeTodo());
    const filePath = path.join(tmpDir, ".harness", "todos.json");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("returns empty array when no todos exist", () => {
    expect(store.list()).toEqual([]);
  });

  it("adds and retrieves a todo", () => {
    const todo = makeTodo();
    store.add(todo);
    const items = store.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(todo);
  });

  it("gets a todo by id", () => {
    const todo = makeTodo({ id: "abc" });
    store.add(todo);
    expect(store.get("abc")).toEqual(todo);
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("updates a todo", () => {
    store.add(makeTodo({ id: "u1" }));
    store.update("u1", { status: "running", tmuxSessionId: "tmux-123" });
    const updated = store.get("u1");
    expect(updated?.status).toBe("running");
    expect(updated?.tmuxSessionId).toBe("tmux-123");
  });

  it("deletes a todo", () => {
    store.add(makeTodo({ id: "d1" }));
    store.delete("d1");
    expect(store.list()).toHaveLength(0);
  });

  it("handles multiple todos", () => {
    store.add(makeTodo({ id: "m1", title: "First" }));
    store.add(makeTodo({ id: "m2", title: "Second" }));
    expect(store.list()).toHaveLength(2);
  });
});
