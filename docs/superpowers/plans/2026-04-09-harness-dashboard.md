# Easy Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent Claude Code skill package that provides a terminal-based todo management system backed by Ink UI, with each todo linked to an auto-launched Claude Code session via tmux.

**Architecture:** A Claude Code plugin with 4 skills (SKILL.md files with bundled TypeScript scripts). Core logic lives in `src/` (store, services, utils), Ink UI in `src/ui/`, skills reference scripts via Bash. Data persisted in `.harness/todos.json` in the working directory.

**Tech Stack:** TypeScript, Ink (React for CLI), tmux, vitest, ink-testing-library

**Spec:** `docs/superpowers/specs/2026-04-09-easy-harness-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `easy-harness/package.json`
- Create: `easy-harness/tsconfig.json`
- Create: `easy-harness/vitest.config.ts`
- Create: `easy-harness/.claude-plugin/plugin.json`

- [ ] **Step 1: Create project directory**

```bash
mkdir -p easy-harness/.claude-plugin
cd easy-harness
```

- [ ] **Step 2: Write package.json**

```json
{
  "name": "easy-harness",
  "version": "0.1.4",
  "description": "Claude Code skill package for terminal-based todo management with tmux-backed Claude sessions",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "dashboard": "tsx src/ui/run.tsx"
  },
  "dependencies": {
    "ink": "^5.1.0",
    "ink-text-input": "^6.0.0",
    "react": "^18.3.1",
    "nanoid": "^5.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "ink-testing-library": "^4.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Write vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 5: Write plugin.json**

```json
{
  "name": "easy-harness",
  "description": "Terminal-based todo management with tmux-backed Claude Code sessions",
  "version": "0.1.4",
  "skills": [
    "./skills/easy-harness",
    "./skills/harness-todo-create",
    "./skills/harness-session-send-user-message",
    "./skills/harness-notice-user"
  ]
}
```

- [ ] **Step 6: Install dependencies**

```bash
cd easy-harness && npm install
```

- [ ] **Step 7: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold easy-harness project"
```

---

### Task 2: Types Definition

**Files:**
- Create: `easy-harness/src/types.ts`

- [ ] **Step 1: Write TodoItem interface and related types**

```typescript
export type TodoStatus = "pending" | "running" | "done" | "failed";

export interface TodoItem {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  tmuxSessionId: string;
  remoteControlUrl: string;
  claudeSessionId: string;
  claudeSessionName: string;
}

export interface NoticeMessage {
  title: string;
  status: string;
  summary: string;
  tmuxSessionId: string;
  remoteControlUrl: string;
}

export interface MessageSender {
  send(message: NoticeMessage): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add TodoItem and NoticeMessage type definitions"
```

---

### Task 3: ID Utility (TDD)

**Files:**
- Create: `easy-harness/tests/utils/id.test.ts`
- Create: `easy-harness/src/utils/id.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { generateId } from "../../src/utils/id.js";

describe("generateId", () => {
  it("returns a non-empty string", () => {
    const id = generateId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("returns unique ids on each call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it("returns an id of reasonable length", () => {
    const id = generateId();
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(32);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd easy-harness && npx vitest run tests/utils/id.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import { nanoid } from "nanoid";

export function generateId(): string {
  return nanoid(12);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd easy-harness && npx vitest run tests/utils/id.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 5: Commit**

```bash
git add src/utils/id.ts tests/utils/id.test.ts
git commit -m "feat: add ID generation utility"
```

---

### Task 4: Todo Store (TDD)

**Files:**
- Create: `easy-harness/tests/store.test.ts`
- Create: `easy-harness/src/store.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd easy-harness && npx vitest run tests/store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import fs from "node:fs";
import path from "node:path";
import type { TodoItem } from "./types.js";

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
    items.push(todo);
    this.write(items);
  }

  update(id: string, updates: Partial<Omit<TodoItem, "id">>): void {
    const items = this.read();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return;
    items[index] = { ...items[index], ...updates };
    this.write(items);
  }

  delete(id: string): void {
    const items = this.read().filter((item) => item.id !== id);
    this.write(items);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd easy-harness && npx vitest run tests/store.test.ts`
Expected: PASS — all 7 tests green

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: add TodoStore with JSON file persistence"
```

---

### Task 5: Tmux Service (TDD)

**Files:**
- Create: `easy-harness/tests/services/tmux.test.ts`
- Create: `easy-harness/src/services/tmux.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import {
  buildCreateSessionCommand,
  buildSendKeysCommand,
  buildClaudeCommand,
  parseTmuxSessionId,
} from "../../src/services/tmux.js";

describe("tmux command builders", () => {
  it("builds create session command", () => {
    const cmd = buildCreateSessionCommand({
      sessionName: "harness-abc123",
      claudeCommand: `claude -n '[HARNESS_SESSION]Fix login bug' --remote-control '当前任务信息是：修复登录页面的bug；当前待办项的id是abc123'`,
    });
    expect(cmd).toContain("tmux new-session -d");
    expect(cmd).toContain("-s harness-abc123");
    expect(cmd).toContain("claude -n");
    expect(cmd).toContain("--remote-control");
  });

  it("builds send-keys command", () => {
    const cmd = buildSendKeysCommand("harness-abc123", "请帮我修复这个bug");
    expect(cmd).toContain("tmux send-keys");
    expect(cmd).toContain("-t harness-abc123");
    expect(cmd).toContain("Enter");
  });

  it("parses tmux session id from list output", () => {
    const output = "harness-abc123: 1 windows (created Wed Apr  9 10:00:00 2026)";
    const id = parseTmuxSessionId(output, "harness-abc123");
    expect(id).toBe("harness-abc123");
  });

  it("returns undefined when session not found", () => {
    const output = "other-session: 1 windows (created Wed Apr  9 10:00:00 2026)";
    const id = parseTmuxSessionId(output, "harness-abc123");
    expect(id).toBeUndefined();
  });
});

describe("buildClaudeCommand", () => {
  it("builds claude launch command with all parameters", () => {
    const cmd = buildClaudeCommand({
      sessionName: "[HARNESS_SESSION]Fix login bug",
      todoId: "abc123",
      description: "修复登录页面的bug",
    });
    expect(cmd).toContain("claude -n");
    expect(cmd).toContain("[HARNESS_SESSION]Fix login bug");
    expect(cmd).toContain("--remote-control");
    expect(cmd).toContain("abc123");
    expect(cmd).toContain("修复登录页面的bug");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd easy-harness && npx vitest run tests/services/tmux.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import { execSync } from "node:child_process";

export interface CreateSessionOptions {
  sessionName: string;
  claudeCommand: string;
}

export interface ClaudeCommandOptions {
  sessionName: string;
  todoId: string;
  description: string;
}

export function buildClaudeCommand(options: ClaudeCommandOptions): string {
  const { sessionName, todoId, description } = options;
  const prompt = `当前任务信息是：${description}；当前待办项的id是${todoId}`;
  return `claude -n '${sessionName}' --remote-control '${prompt}'`;
}

export function buildCreateSessionCommand(options: CreateSessionOptions): string {
  const { sessionName, claudeCommand } = options;
  return `tmux new-session -d -s ${sessionName} "${claudeCommand}"`;
}

export function buildSendKeysCommand(sessionName: string, text: string): string {
  const escaped = text.replace(/'/g, "'\\''");
  return `tmux send-keys -t ${sessionName} '${escaped}' Enter`;
}

export function parseTmuxSessionId(
  listOutput: string,
  sessionName: string
): string | undefined {
  const lines = listOutput.split("\n");
  for (const line of lines) {
    if (line.startsWith(`${sessionName}:`)) {
      return sessionName;
    }
  }
  return undefined;
}

export function createTmuxSession(options: CreateSessionOptions): void {
  const cmd = buildCreateSessionCommand(options);
  execSync(cmd);
}

export function sendKeysToSession(sessionName: string, text: string): void {
  const cmd = buildSendKeysCommand(sessionName, text);
  execSync(cmd);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd easy-harness && npx vitest run tests/services/tmux.test.ts`
Expected: PASS — all 5 tests green

- [ ] **Step 5: Commit**

```bash
git add src/services/tmux.ts tests/services/tmux.test.ts
git commit -m "feat: add tmux service with command builders"
```

---

### Task 6: Session Log Parser (TDD)

**Files:**
- Create: `easy-harness/tests/services/session-log.test.ts`
- Create: `easy-harness/src/services/session-log.ts`
- Create: `easy-harness/tests/fixtures/sample-session.jsonl`

- [ ] **Step 1: Create test fixture**

```jsonl
{"type":"user","uuid":"u1","message":{"role":"user","content":"帮我写一个函数"},"timestamp":"2026-04-09T10:00:00Z","sessionId":"sess-001"}
{"type":"assistant","uuid":"a1","parentUuid":"u1","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"好的，我来帮你写一个函数。"}],"stop_reason":"end_turn"},"timestamp":"2026-04-09T10:00:05Z","sessionId":"sess-001"}
{"type":"user","uuid":"u2","parentUuid":"a1","message":{"role":"user","content":"请加上错误处理"},"timestamp":"2026-04-09T10:01:00Z","sessionId":"sess-001"}
{"type":"assistant","uuid":"a2","parentUuid":"u2","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"已添加错误处理逻辑，现在函数会捕获异常并返回默认值。"}],"stop_reason":"end_turn"},"timestamp":"2026-04-09T10:01:10Z","sessionId":"sess-001"}
```

- [ ] **Step 2: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import path from "node:path";
import { getLastConversationTurn, findSessionLogFile } from "../../src/services/session-log.js";

describe("getLastConversationTurn", () => {
  const fixturePath = path.join(__dirname, "../fixtures/sample-session.jsonl");

  it("extracts the last user message", () => {
    const result = getLastConversationTurn(fixturePath);
    expect(result?.userMessage).toBe("请加上错误处理");
  });

  it("extracts the last assistant message", () => {
    const result = getLastConversationTurn(fixturePath);
    expect(result?.assistantMessage).toBe(
      "已添加错误处理逻辑，现在函数会捕获异常并返回默认值。"
    );
  });

  it("returns undefined for non-existent file", () => {
    const result = getLastConversationTurn("/nonexistent/file.jsonl");
    expect(result).toBeUndefined();
  });
});

describe("findSessionLogFile", () => {
  it("returns undefined for non-existent session", () => {
    const result = findSessionLogFile("nonexistent-session-id");
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd easy-harness && npx vitest run tests/services/session-log.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write minimal implementation**

```typescript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ConversationTurn {
  userMessage: string;
  assistantMessage: string;
}

interface JournalEntry {
  type: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
}

function extractTextContent(
  content: string | Array<{ type: string; text?: string }>
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text!)
    .join("\n");
}

export function getLastConversationTurn(
  filePath: string
): ConversationTurn | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
  let lastUser: string | undefined;
  let lastAssistant: string | undefined;

  // 从后往前找最后一对 user + assistant
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry: JournalEntry = JSON.parse(lines[i]);

    if (
      !lastAssistant &&
      entry.type === "assistant" &&
      entry.message?.content
    ) {
      lastAssistant = extractTextContent(entry.message.content);
    }

    if (
      lastAssistant &&
      !lastUser &&
      entry.type === "user" &&
      entry.message?.role === "user"
    ) {
      const content = entry.message.content;
      // 跳过 tool_result 类型的 user 消息
      if (typeof content === "string") {
        lastUser = content;
      } else if (
        Array.isArray(content) &&
        content.some((b) => b.type === "text")
      ) {
        lastUser = extractTextContent(content);
      } else {
        continue;
      }
    }

    if (lastUser && lastAssistant) {
      return { userMessage: lastUser, assistantMessage: lastAssistant };
    }
  }

  return undefined;
}

export function findSessionLogFile(
  sessionId: string
): string | undefined {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeDir)) {
    return undefined;
  }

  // 遍历项目目录，查找匹配的 session JSONL 文件
  const projectDirs = fs.readdirSync(claudeDir);
  for (const projectDir of projectDirs) {
    const projectPath = path.join(claudeDir, projectDir);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const sessionFile = path.join(projectPath, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionFile)) {
      return sessionFile;
    }
  }

  return undefined;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd easy-harness && npx vitest run tests/services/session-log.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 6: Commit**

```bash
git add src/services/session-log.ts tests/services/session-log.test.ts tests/fixtures/sample-session.jsonl
git commit -m "feat: add session log parser for JSONL conversation extraction"
```

---

### Task 7: Notice Service (TDD)

**Files:**
- Create: `easy-harness/tests/services/notice.test.ts`
- Create: `easy-harness/src/services/notice.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import {
  ConsoleMessageSender,
  formatNoticeMessage,
} from "../../src/services/notice.js";
import type { NoticeMessage } from "../../src/types.js";

describe("formatNoticeMessage", () => {
  const message: NoticeMessage = {
    title: "Fix login bug",
    status: "done",
    summary: "已修复登录页面的表单验证问题",
    tmuxSessionId: "harness-abc123",
    remoteControlUrl: "http://localhost:3000/rc/abc",
  };

  it("formats message with all fields", () => {
    const text = formatNoticeMessage(message);
    expect(text).toContain("Fix login bug");
    expect(text).toContain("done");
    expect(text).toContain("已修复登录页面的表单验证问题");
    expect(text).toContain("harness-abc123");
    expect(text).toContain("http://localhost:3000/rc/abc");
  });
});

describe("ConsoleMessageSender", () => {
  it("implements MessageSender interface", async () => {
    const sender = new ConsoleMessageSender();
    // 不抛错即通过
    await sender.send({
      title: "Test",
      status: "done",
      summary: "test summary",
      tmuxSessionId: "tmux-1",
      remoteControlUrl: "http://localhost:3000",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd easy-harness && npx vitest run tests/services/notice.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { MessageSender, NoticeMessage } from "../types.js";

export function formatNoticeMessage(message: NoticeMessage): string {
  return [
    `📋 ${message.title}`,
    `状态: ${message.status}`,
    `摘要: ${message.summary}`,
    `Tmux Session: ${message.tmuxSessionId}`,
    `Remote URL: ${message.remoteControlUrl}`,
  ].join("\n");
}

export class ConsoleMessageSender implements MessageSender {
  async send(message: NoticeMessage): Promise<void> {
    console.log(formatNoticeMessage(message));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd easy-harness && npx vitest run tests/services/notice.test.ts`
Expected: PASS — all 2 tests green

- [ ] **Step 5: Commit**

```bash
git add src/services/notice.ts tests/services/notice.test.ts
git commit -m "feat: add notice service with abstract MessageSender interface"
```

---

### Task 8: Ink Dashboard UI

**Files:**
- Create: `easy-harness/src/ui/run.tsx`
- Create: `easy-harness/src/ui/app.tsx`
- Create: `easy-harness/src/ui/components/TodoList.tsx`
- Create: `easy-harness/src/ui/components/TodoForm.tsx`
- Create: `easy-harness/src/ui/components/ExecutePrompt.tsx`

这个任务构建完整的 Ink 终端 UI。由于 Ink 组件依赖终端环境，测试以手动验证为主。

- [ ] **Step 1: Create run.tsx — Ink app entry point**

```tsx
#!/usr/bin/env npx tsx
import React from "react";
import { render } from "ink";
import { App } from "./app.js";

const cwd = process.argv[2] || process.cwd();
render(<App cwd={cwd} />);
```

- [ ] **Step 2: Create app.tsx — main app with view routing**

```tsx
import React, { useState } from "react";
import { Box, Text } from "ink";
import { TodoList } from "./components/TodoList.js";
import { TodoForm } from "./components/TodoForm.js";
import { ExecutePrompt } from "./components/ExecutePrompt.js";
import { TodoStore } from "../store.js";

type View = "list" | "create" | "edit" | "execute";

interface AppProps {
  cwd: string;
}

export function App({ cwd }: AppProps) {
  const [view, setView] = useState<View>("list");
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const store = new TodoStore(cwd);

  if (view === "create") {
    return (
      <TodoForm
        mode="create"
        onSubmit={(description) => {
          // 输出 JSON 供 SKILL.md 读取
          process.stdout.write(
            JSON.stringify({ action: "create", description }) + "\n"
          );
          setView("list");
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  if (view === "edit" && selectedTodoId) {
    const todo = store.get(selectedTodoId);
    return (
      <TodoForm
        mode="edit"
        initialValue={todo?.description ?? ""}
        onSubmit={(description) => {
          process.stdout.write(
            JSON.stringify({
              action: "edit",
              id: selectedTodoId,
              description,
            }) + "\n"
          );
          setView("list");
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  if (view === "execute" && selectedTodoId) {
    return (
      <ExecutePrompt
        todoId={selectedTodoId}
        onSubmit={(text) => {
          process.stdout.write(
            JSON.stringify({
              action: "execute",
              id: selectedTodoId,
              text,
            }) + "\n"
          );
          setView("list");
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  return (
    <TodoList
      store={store}
      onSelect={(id, action) => {
        setSelectedTodoId(id);
        if (action === "delete") {
          store.delete(id);
        } else {
          setView(action);
        }
      }}
      onCreate={() => setView("create")}
    />
  );
}
```

- [ ] **Step 3: Create TodoList.tsx**

```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TodoStore } from "../../store.js";
import type { TodoItem, TodoStatus } from "../../types.js";

const STATUS_COLORS: Record<TodoStatus, string> = {
  pending: "gray",
  running: "blue",
  done: "green",
  failed: "red",
};

interface TodoListProps {
  store: TodoStore;
  onSelect: (id: string, action: "edit" | "delete" | "execute") => void;
  onCreate: () => void;
}

export function TodoList({ store, onSelect, onCreate }: TodoListProps) {
  const items = store.list();
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setCursor((prev) => Math.min(items.length - 1, prev + 1));
    }
    if (input === "n") {
      onCreate();
    }
    if (input === "e" && items[cursor]) {
      onSelect(items[cursor].id, "edit");
    }
    if (input === "d" && items[cursor]) {
      onSelect(items[cursor].id, "delete");
    }
    if (input === "x" && items[cursor]) {
      onSelect(items[cursor].id, "execute");
    }
    if (input === "q") {
      process.exit(0);
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>📋 Easy Harness</Text>
      </Box>

      {items.length === 0 ? (
        <Text color="gray">暂无待办项。按 n 新建。</Text>
      ) : (
        items.map((item, index) => (
          <Box key={item.id}>
            <Text color={index === cursor ? "cyan" : undefined}>
              {index === cursor ? "▸ " : "  "}
            </Text>
            <Text color={STATUS_COLORS[item.status]}>[{item.status}]</Text>
            <Text> {item.title}</Text>
            <Text color="gray"> ({item.id})</Text>
          </Box>
        ))
      )}

      <Box marginTop={1}>
        <Text color="gray">
          ↑↓ 移动 | n 新建 | e 编辑 | d 删除 | x 执行 | q 退出
        </Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Create TodoForm.tsx**

```tsx
import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface TodoFormProps {
  mode: "create" | "edit";
  initialValue?: string;
  onSubmit: (description: string) => void;
  onCancel: () => void;
}

export function TodoForm({
  mode,
  initialValue = "",
  onSubmit,
  onCancel,
}: TodoFormProps) {
  const [value, setValue] = useState(initialValue);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          {mode === "create" ? "新建待办项" : "编辑待办项"}
        </Text>
      </Box>
      <Box>
        <Text>描述: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(text) => {
            if (text.trim()) {
              onSubmit(text.trim());
            }
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Enter 确认 | Esc 取消</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 5: Create ExecutePrompt.tsx**

```tsx
import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface ExecutePromptProps {
  todoId: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function ExecutePrompt({ todoId, onSubmit, onCancel }: ExecutePromptProps) {
  const [value, setValue] = useState("");

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>发送消息到会话</Text>
        <Text color="gray"> (待办项: {todoId})</Text>
      </Box>
      <Box>
        <Text>消息: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(text) => {
            if (text.trim()) {
              onSubmit(text.trim());
            }
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Enter 发送 | Esc 取消</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 6: Verify build**

Run: `cd easy-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/ui/
git commit -m "feat: add Ink dashboard UI with TodoList, TodoForm, ExecutePrompt"
```

---

### Task 9: SKILL.md Files

**Files:**
- Create: `easy-harness/skills/easy-harness/SKILL.md`
- Create: `easy-harness/skills/harness-todo-create/SKILL.md`
- Create: `easy-harness/skills/harness-session-send-user-message/SKILL.md`
- Create: `easy-harness/skills/harness-notice-user/SKILL.md`

- [ ] **Step 1: Write easy-harness SKILL.md**

```markdown
---
name: easy-harness
description: "Open the Easy Harness terminal UI to manage todo items. Use when the user wants to view, create, edit, delete, or execute todo items in the harness system. Triggers on: /easy-harness, 'open dashboard', 'show todos', 'harness list'."
---

# Easy Harness

打开基于 Ink 的终端待办项管理界面。

## 使用方式

运行 dashboard 脚本：

\`\`\`bash
npx tsx <plugin-dir>/src/ui/run.tsx <cwd>
\`\`\`

其中 `<cwd>` 为当前工作目录（.harness/todos.json 所在目录的父目录）。

## Dashboard 输出处理

Dashboard 通过 stdout 输出 JSON 操作指令，格式如下：

- 新建：`{"action": "create", "description": "..."}`
  - 收到此指令后，调用 `/harness-todo-create` skill，传入 description
- 编辑：`{"action": "edit", "id": "...", "description": "..."}`
  - 收到此指令后，更新 .harness/todos.json 中对应待办项的 description 字段
  - 根据新 description 重新生成标题并更新
- 删除：在 dashboard 内直接完成，无需额外处理
- 执行：`{"action": "execute", "id": "...", "text": "..."}`
  - 收到此指令后，调用 `/harness-session-send-user-message` skill，传入 id 和 text
```

- [ ] **Step 2: Write harness-todo-create SKILL.md**

```markdown
---
name: harness-todo-create
description: "Create a new harness todo item from a description. Analyzes the description, generates a title and unique ID, creates the todo record, and launches a Claude Code session in tmux. Use when user wants to create a new todo/task in the harness system."
---

# Harness Todo Create

根据用户描述创建新的待办项，并自动启动关联的 Claude Code 会话。

## 输入

用户提供一段描述文本（纯文本），可能包含 meego 需求链接等外部引用。

## 处理流程

### 1. 分析描述

- 阅读用户提供的描述
- 如果描述中包含 meego 需求链接或 ID，使用 `/bytedcli` 获取需求详情，补充到描述中
- 根据描述内容，总结生成一个简短的标题（10-20 个字）

### 2. 创建待办项记录

使用 Bash 运行以下脚本来生成 ID 并写入记录：

\`\`\`bash
npx tsx -e "
import { generateId } from '<plugin-dir>/src/utils/id.js';
import { TodoStore } from '<plugin-dir>/src/store.js';
const store = new TodoStore(process.argv[1]);
const id = generateId();
store.add({
  id,
  title: process.argv[2],
  description: process.argv[3],
  status: 'pending',
  tmuxSessionId: '',
  remoteControlUrl: '',
  claudeSessionId: '',
  claudeSessionName: '',
});
console.log(id);
" "<cwd>" "<title>" "<description>"
\`\`\`

### 3. 启动 Claude Code 会话

\`\`\`bash
SESSION_NAME="[HARNESS_SESSION]<title>"
TMUX_NAME="harness-<id>"
tmux new-session -d -s "$TMUX_NAME" "claude -n '$SESSION_NAME' --remote-control '当前任务信息是：<description>；当前待办项的id是<id>'"
\`\`\`

### 4. 记录会话信息

启动后，需要获取并记录以下信息到待办项：
- `tmuxSessionId`: 即 `harness-<id>`
- `remoteControlUrl`: 从 Claude 启动输出中获取 remote-control URL
- `claudeSessionId`: Claude Code 的 session ID
- `claudeSessionName`: 即 `[HARNESS_SESSION]<title>`
- 将状态更新为 `running`

使用 Bash 更新记录：

\`\`\`bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.js';
const store = new TodoStore(process.argv[1]);
store.update(process.argv[2], {
  status: 'running',
  tmuxSessionId: process.argv[3],
  remoteControlUrl: process.argv[4],
  claudeSessionId: process.argv[5],
  claudeSessionName: process.argv[6],
});
" "<cwd>" "<id>" "<tmuxSessionId>" "<remoteControlUrl>" "<claudeSessionId>" "<claudeSessionName>"
\`\`\`
```

- [ ] **Step 3: Write harness-session-send-user-message SKILL.md**

```markdown
---
name: harness-session-send-user-message
description: "Send a user message to an existing Claude Code session linked to a harness todo item. Uses tmux send-keys to deliver the message. Use when user wants to send instructions to a running harness session."
---

# Harness Session Send User Message

向指定待办项关联的 Claude Code 会话发送用户消息。

## 输入

- 待办项 ID
- 要发送的文本内容

## 处理流程

### 1. 查找待办项

\`\`\`bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.js';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (!todo) { console.error('待办项不存在'); process.exit(1); }
console.log(JSON.stringify({ tmuxSessionId: todo.tmuxSessionId, status: todo.status }));
" "<cwd>" "<todo-id>"
\`\`\`

### 2. 发送消息

确认待办项状态为 `running` 后，通过 tmux send-keys 发送消息：

\`\`\`bash
tmux send-keys -t "<tmuxSessionId>" '<用户输入的文本>' Enter
\`\`\`

### 3. 错误处理

- 如果待办项不存在，告知用户
- 如果待办项状态不是 `running`，告知用户该会话未在运行
- 如果 tmux 会话不存在，告知用户会话已关闭
```

- [ ] **Step 4: Write harness-notice-user SKILL.md**

```markdown
---
name: harness-notice-user
description: "Send a notification message about a harness todo item's status. Reads the Claude session JSONL log to extract the last conversation turn, generates a summary, and sends it through the configured message channel. Use when a harness session ends and needs to notify the user."
---

# Harness Notice User

发送待办项状态通知。从 Claude 会话日志中提取最后一轮对话，生成摘要并推送。

## 输入

- 待办项 ID

## 处理流程

### 1. 读取待办项信息

\`\`\`bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.js';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (!todo) { console.error('待办项不存在'); process.exit(1); }
console.log(JSON.stringify(todo));
" "<cwd>" "<todo-id>"
\`\`\`

### 2. 提取最后一轮对话

\`\`\`bash
npx tsx -e "
import { findSessionLogFile, getLastConversationTurn } from '<plugin-dir>/src/services/session-log.js';
const file = findSessionLogFile(process.argv[1]);
if (!file) { console.error('未找到会话日志'); process.exit(1); }
const turn = getLastConversationTurn(file);
console.log(JSON.stringify(turn));
" "<claudeSessionId>"
\`\`\`

### 3. 生成摘要

根据提取到的最后一轮 user 消息和 assistant 消息，生成一段简短的摘要（50-100 字）。

### 4. 发送通知

将以下信息组装为通知消息：
- 待办项标题
- 待办项状态
- 上一步生成的摘要
- tmux 对话 ID
- remote-control URL

当前使用 console 输出。后续可扩展为飞书/Telegram 等推送渠道，通过实现 `MessageSender` 接口。

\`\`\`bash
npx tsx -e "
import { formatNoticeMessage } from '<plugin-dir>/src/services/notice.js';
console.log(formatNoticeMessage({
  title: process.argv[1],
  status: process.argv[2],
  summary: process.argv[3],
  tmuxSessionId: process.argv[4],
  remoteControlUrl: process.argv[5],
}));
" "<title>" "<status>" "<summary>" "<tmuxSessionId>" "<remoteControlUrl>"
\`\`\`
```

- [ ] **Step 5: Commit**

```bash
git add skills/
git commit -m "feat: add SKILL.md files for all 4 skills"
```

---

### Task 10: Hook Script

**Files:**
- Create: `easy-harness/hook/on-session-end.sh`

- [ ] **Step 1: Write the hook script**

```bash
#!/bin/bash
# Easy Harness — 会话结束 hook
# 检测是否为 harness 管理的会话，若是则触发通知

# 获取当前 tmux 会话名称（如果在 tmux 中）
if [ -z "$TMUX" ]; then
  exit 0
fi

TMUX_SESSION_NAME=$(tmux display-message -p '#S')

# 检查是否为 harness 管理的会话（以 harness- 为前缀）
if [[ "$TMUX_SESSION_NAME" != harness-* ]]; then
  exit 0
fi

CWD="${1:-.}"

# 从 todos.json 中查找对应的待办项 ID
TODO_ID=$(npx tsx -e "
import { TodoStore } from '$(dirname "$0")/../src/store.js';
const store = new TodoStore(process.argv[1]);
const todos = store.list();
const todo = todos.find(t => t.tmuxSessionId === process.argv[2]);
if (todo) console.log(todo.id);
" "$CWD" "$TMUX_SESSION_NAME")

if [ -z "$TODO_ID" ]; then
  exit 0
fi

echo "harness:session-end:$TODO_ID"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x hook/on-session-end.sh
```

- [ ] **Step 3: Commit**

```bash
git add hook/
git commit -m "feat: add session-end hook script"
```

---

### Task 11: Hook Configuration Documentation

**Files:**
- Create: `easy-harness/README.md`

- [ ] **Step 1: Write README with installation and hook setup instructions**

```markdown
# Easy Harness

Claude Code skill package for terminal-based todo management with tmux-backed Claude sessions.

## Installation

Install this plugin in Claude Code:

\`\`\`bash
claude plugins install <path-to-easy-harness>
\`\`\`

## Hook Setup

Add the following hook to your Claude Code `settings.json` to enable auto-notification on session end:

\`\`\`json
{
  "hooks": {
    "PostToolUse": [],
    "SessionEnd": [
      {
        "name": "harness-session-end",
        "command": "<plugin-dir>/hook/on-session-end.sh $CWD"
      }
    ]
  }
}
\`\`\`

## Skills

- `/easy-harness` — Open the terminal todo management UI
- `/harness-todo-create` — Create a new todo from a description
- `/harness-session-send-user-message` — Send a message to a running Claude session
- `/harness-notice-user` — Send a notification about a todo's status

## Data

Todo items are stored in `.harness/todos.json` in the current working directory.
\`\`\`

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with installation and hook setup instructions"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run all tests**

Run: `cd easy-harness && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd easy-harness && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify directory structure**

Run: `cd easy-harness && find . -not -path './node_modules/*' -not -path './dist/*' -not -name '.DS_Store' | sort`

Expected output:
```
.
./.claude-plugin
./.claude-plugin/plugin.json
./hook
./hook/on-session-end.sh
./package.json
./README.md
./skills
./skills/easy-harness
./skills/easy-harness/SKILL.md
./skills/harness-notice-user
./skills/harness-notice-user/SKILL.md
./skills/harness-session-send-user-message
./skills/harness-session-send-user-message/SKILL.md
./skills/harness-todo-create
./skills/harness-todo-create/SKILL.md
./src
./src/services
./src/services/notice.ts
./src/services/session-log.ts
./src/services/tmux.ts
./src/store.ts
./src/types.ts
./src/ui
./src/ui/app.tsx
./src/ui/components
./src/ui/components/ExecutePrompt.tsx
./src/ui/components/TodoForm.tsx
./src/ui/components/TodoList.tsx
./src/ui/run.tsx
./src/utils
./src/utils/id.ts
./tests
./tests/fixtures
./tests/fixtures/sample-session.jsonl
./tests/services
./tests/services/notice.test.ts
./tests/services/session-log.test.ts
./tests/services/tmux.test.ts
./tests/store.test.ts
./tests/utils
./tests/utils/id.test.ts
./tsconfig.json
./vitest.config.ts
```

- [ ] **Step 4: Final commit (if any uncommitted changes)**

```bash
git status
```
