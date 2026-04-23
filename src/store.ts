import fs from "node:fs";
import path from "node:path";
import type { TodoItem } from "./types.js";
import { debugLog } from "./utils/debug-log.js";

export class TodoStore {
  private filePath: string;

  constructor(private baseDir: string) {
    this.filePath = path.join(baseDir, ".harness", "todos.json");
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private read(): TodoItem[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    const raw = fs.readFileSync(this.filePath, "utf-8");
    return JSON.parse(raw);
  }

  private write(items: TodoItem[]): void {
    this.ensureDir();
    fs.writeFileSync(this.filePath, JSON.stringify(items, null, 2));
  }

  list(): TodoItem[] {
    return this.read();
  }

  get(id: string): TodoItem | undefined {
    return this.read().find((item) => item.id === id);
  }

  add(todo: TodoItem): void {
    const items = this.read();
    const normalized = { ...todo };
    if (normalized.metadata && Object.keys(normalized.metadata).length === 0) {
      delete normalized.metadata;
    }
    items.push(normalized);
    this.write(items);
    debugLog("store", "add", { id: todo.id, title: todo.title, status: todo.status });
  }

  update(id: string, updates: Partial<Omit<TodoItem, "id">>): void {
    const items = this.read();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return;
    const merged = { ...items[index], ...updates };
    if (merged.metadata && Object.keys(merged.metadata).length === 0) {
      delete merged.metadata;
    }
    items[index] = merged;
    this.write(items);
    debugLog("store", "update", { id, keys: Object.keys(updates) });
  }

  delete(id: string): void {
    const items = this.read().filter((item) => item.id !== id);
    this.write(items);
    debugLog("store", "delete", { id });
  }
}
