# Harness Todo Flexible Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `harness-todo-list` 表格新增序号列，并让 `harness-session-send-user-message` 支持按序号 / ID / title 模糊三种方式查找待办项。

**Architecture:** 把"按多种标识查找待办项"的逻辑从 skill 的内联 tsx 脚本里抽出来，放到 `src/utils/lookup.ts`，用 vitest 做单元测试。两个 skill 的 Markdown 文件改写：列表加序号列；发消息 skill 调用新查找模块并实现"模糊命中 → 用户确认"两阶段流程。

**Tech Stack:** TypeScript 5.7 + Node ESM + vitest + tsx；skill 是 Markdown 工作流，靠内联 `npx tsx -e` 调用 TS。

**Spec:** `docs/superpowers/specs/2026-04-13-harness-todo-flexible-lookup-design.md`

---

## File Structure

| 操作 | 路径 | 责任 |
|------|------|------|
| 新建 | `src/utils/lookup.ts` | 纯函数：输入字符串 + 待办项数组，返回 match / confirm / 抛错 |
| 新建 | `tests/utils/lookup.test.ts` | `lookupTodo` 与 `resolveCandidate` 单元测试 |
| 修改 | `skills/harness-todo-list/SKILL.md` | 表格首列加 `#` 序号列，加临时索引提示 |
| 修改 | `skills/harness-session-send-user-message/SKILL.md` | 调用 `lookupTodo`，新增确认子流程 |

设计要点：
- 查找逻辑是纯函数，不读文件、不依赖 `TodoStore`（让测试更纯粹）。skill 脚本负责 `store.list()` 后把数组传给查找函数。
- 错误用专门的 `LookupError` 表达 code，skill 脚本根据 code 写出对应文案。
- `lookupTodo` 处理"首次查找"，`resolveCandidate` 处理"用户从候选列表里选"。两个函数算法相似但语义不同，分开避免歧义。

---

## Task 1: 实现 `src/utils/lookup.ts` 与测试

**Files:**
- Create: `src/utils/lookup.ts`
- Test: `tests/utils/lookup.test.ts`

- [ ] **Step 1.1: 写失败测试 `tests/utils/lookup.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { lookupTodo, resolveCandidate, LookupError } from "../../src/utils/lookup.js";
import type { TodoItem } from "../../src/types.js";

const makeTodo = (overrides: Partial<TodoItem>): TodoItem => ({
  id: "id-default",
  title: "Default Title",
  description: "",
  status: "pending",
  tmuxSessionId: "",
  remoteControlUrl: "",
  claudeSessionId: "",
  claudeSessionName: "",
  ...overrides,
});

const items: TodoItem[] = [
  makeTodo({ id: "abc123def456", title: "实现登录功能" }),
  makeTodo({ id: "xyz789ghi012", title: "登录页样式调整" }),
  makeTodo({ id: "jkl345mno678", title: "性能优化" }),
];

describe("lookupTodo", () => {
  describe("序号路径", () => {
    it("按 1-based 序号定位首项", () => {
      const r = lookupTodo("1", items);
      expect(r).toEqual({ mode: "match", todo: items[0] });
    });

    it("按 1-based 序号定位末项", () => {
      const r = lookupTodo("3", items);
      expect(r).toEqual({ mode: "match", todo: items[2] });
    });

    it("input 含前后空格也能识别为序号", () => {
      const r = lookupTodo("  2  ", items);
      expect(r).toEqual({ mode: "match", todo: items[1] });
    });

    it("序号 0 抛 OUT_OF_RANGE", () => {
      expect(() => lookupTodo("0", items)).toThrow(LookupError);
      try { lookupTodo("0", items); } catch (e) {
        expect((e as LookupError).code).toBe("OUT_OF_RANGE");
        expect((e as LookupError).message).toContain("有效范围 1–3");
      }
    });

    it("序号超过长度抛 OUT_OF_RANGE", () => {
      expect(() => lookupTodo("4", items)).toThrow(LookupError);
    });

    it("空列表上的序号查询抛 OUT_OF_RANGE", () => {
      expect(() => lookupTodo("1", [])).toThrow(LookupError);
    });
  });

  describe("ID 精确匹配", () => {
    it("命中完整 nanoid", () => {
      const r = lookupTodo("xyz789ghi012", items);
      expect(r).toEqual({ mode: "match", todo: items[1] });
    });

    it("ID 大小写敏感", () => {
      // ID 为 abc123def456，输入大写时不该匹配；会落到模糊匹配但 title 不含此片段
      expect(() => lookupTodo("ABC123DEF456", items)).toThrow(LookupError);
    });
  });

  describe("title 模糊匹配", () => {
    it("单条命中也走 confirm 路径", () => {
      const r = lookupTodo("性能", items);
      expect(r.mode).toBe("confirm");
      if (r.mode === "confirm") {
        expect(r.candidates).toEqual([items[2]]);
      }
    });

    it("多条命中返回所有候选", () => {
      const r = lookupTodo("登录", items);
      expect(r.mode).toBe("confirm");
      if (r.mode === "confirm") {
        expect(r.candidates).toEqual([items[0], items[1]]);
      }
    });

    it("大小写不敏感", () => {
      const list = [makeTodo({ id: "uniq111aaa22", title: "Login Refactor" })];
      const r = lookupTodo("login", list);
      expect(r.mode).toBe("confirm");
      if (r.mode === "confirm") {
        expect(r.candidates).toEqual([list[0]]);
      }
    });

    it("零命中抛 NOT_FOUND", () => {
      expect(() => lookupTodo("不存在的关键词", items)).toThrow(LookupError);
      try { lookupTodo("不存在的关键词", items); } catch (e) {
        expect((e as LookupError).code).toBe("NOT_FOUND");
      }
    });

    it("仅匹配 title，不匹配 description", () => {
      const list = [makeTodo({ id: "iddd123aaa44", title: "无关标题", description: "包含关键词xyz" })];
      expect(() => lookupTodo("xyz", list)).toThrow(LookupError);
    });
  });
});

describe("resolveCandidate", () => {
  const candidates: TodoItem[] = [
    makeTodo({ id: "c1aaaabbbb11", title: "实现登录功能" }),
    makeTodo({ id: "c2ccccdddd22", title: "登录页样式调整" }),
  ];

  it("按候选序号定位", () => {
    expect(resolveCandidate("2", candidates)).toBe(candidates[1]);
  });

  it("按 ID 定位", () => {
    expect(resolveCandidate("c1aaaabbbb11", candidates)).toBe(candidates[0]);
  });

  it("候选序号越界抛 OUT_OF_RANGE", () => {
    expect(() => resolveCandidate("3", candidates)).toThrow(LookupError);
  });

  it("非纯数字且未匹配 ID 抛 NOT_FOUND（不再做模糊匹配）", () => {
    expect(() => resolveCandidate("登录", candidates)).toThrow(LookupError);
    try { resolveCandidate("登录", candidates); } catch (e) {
      expect((e as LookupError).code).toBe("NOT_FOUND");
    }
  });
});
```

- [ ] **Step 1.2: 跑测试，确认全部失败**

```bash
cd /Users/bytedance/haha/x/agent/claude-about/easy-harness
npx vitest run tests/utils/lookup.test.ts
```

Expected: 失败，类似 `Cannot find module '../../src/utils/lookup.js'`

- [ ] **Step 1.3: 实现 `src/utils/lookup.ts`**

```typescript
import type { TodoItem } from "../types.js";

// 查找结果：要么直接命中，要么需要用户确认
export type LookupResult =
  | { mode: "match"; todo: TodoItem }
  | { mode: "confirm"; candidates: TodoItem[] };

export type LookupErrorCode = "OUT_OF_RANGE" | "NOT_FOUND";

export class LookupError extends Error {
  constructor(public code: LookupErrorCode, message: string) {
    super(message);
    this.name = "LookupError";
  }
}

const NUMERIC = /^\d+$/;

// 首次查找：序号 → ID 精确 → title 模糊（substring，大小写不敏感）
export function lookupTodo(input: string, items: TodoItem[]): LookupResult {
  const trimmed = input.trim();

  if (NUMERIC.test(trimmed)) {
    const idx = parseInt(trimmed, 10) - 1;
    if (idx < 0 || idx >= items.length) {
      throw new LookupError(
        "OUT_OF_RANGE",
        `序号越界：共 ${items.length} 条待办项，有效范围 1–${items.length}`,
      );
    }
    return { mode: "match", todo: items[idx] };
  }

  const byId = items.find((it) => it.id === trimmed);
  if (byId) {
    return { mode: "match", todo: byId };
  }

  const needle = trimmed.toLowerCase();
  const candidates = items.filter((it) =>
    it.title.toLowerCase().includes(needle),
  );
  if (candidates.length === 0) {
    throw new LookupError(
      "NOT_FOUND",
      "未找到匹配的待办项：请检查序号、ID 或 title 片段是否正确",
    );
  }

  return { mode: "confirm", candidates };
}

// 候选确认阶段：序号 → ID 精确，不再模糊匹配以避免发散
export function resolveCandidate(
  input: string,
  candidates: TodoItem[],
): TodoItem {
  const trimmed = input.trim();

  if (NUMERIC.test(trimmed)) {
    const idx = parseInt(trimmed, 10) - 1;
    if (idx < 0 || idx >= candidates.length) {
      throw new LookupError(
        "OUT_OF_RANGE",
        `候选序号越界：共 ${candidates.length} 条候选项，有效范围 1–${candidates.length}`,
      );
    }
    return candidates[idx];
  }

  const byId = candidates.find((it) => it.id === trimmed);
  if (byId) return byId;

  throw new LookupError(
    "NOT_FOUND",
    "仍未能定位：请重新执行 /harness-session-send-user-message",
  );
}
```

- [ ] **Step 1.4: 跑测试，确认全部通过**

```bash
npx vitest run tests/utils/lookup.test.ts
```

Expected: 全部 PASS（约 14 个测试用例）

- [ ] **Step 1.5: 跑全量测试，确认无回归**

```bash
npm test
```

Expected: 全部 PASS

- [ ] **Step 1.6: Commit**

```bash
git add src/utils/lookup.ts tests/utils/lookup.test.ts
git commit -m "feat: add flexible todo lookup util (index/id/fuzzy-title)"
```

---

## Task 2: 改 `harness-todo-list` 增加序号列

**Files:**
- Modify: `skills/harness-todo-list/SKILL.md`

- [ ] **Step 2.1: 重写 `skills/harness-todo-list/SKILL.md`**

把整个文件替换为：

````markdown
---
name: harness-todo-list
description: "List harness todo items. Use when the user wants to view the todo list / dashboard in the harness system. Triggers on: /harness-todo-list, 'open dashboard', 'show todos', 'harness list'."
---

# Harness Todo List

展示当前工作目录下的待办项列表。

## 使用方式

1. 读取 `<cwd>/.harness/todos.json` 文件
2. 如果文件不存在或内容为空数组，输出：

> 暂无待办项，使用 `/harness-todo-create` 创建。

3. 如果有数据，渲染为 Markdown 表格，列定义如下：

| 列名 | 字段 | 说明 |
|------|------|------|
| # | 数组下标 + 1 | 1-based 序号，按 `store.list()` 返回顺序 |
| Status | `status` | 用 emoji 标记：⚪ pending, 🔵 running, 🟢 done, 🔴 failed |
| Title | `title` | 待办项标题 |
| ID | `id` | 待办项 ID |
| Tmux Session | `tmuxSessionId` | tmux 会话标识 |
| Remote URL | `remoteControlUrl` | 远程控制链接 |

> 序号（#）是展示时的临时索引，删除待办项后会变动；需要跨会话稳定引用时请使用 ID。

## 输出示例

```markdown
| # | Status | Title | ID | Tmux Session | Remote URL |
|---|--------|-------|----|--------------|------------|
| 1 | 🔵 running | 实现登录功能 | abc123 | harness-abc123 | https://... |
| 2 | ⚪ pending | 添加单元测试 | def456 | harness-def456 | https://... |
```

## 相关 Skill

- `/harness-todo-create` — 创建新待办项并启动 Claude 会话
- `/harness-todo-remove` — 删除待办项并关闭其 tmux 会话
- `/harness-session-send-user-message` — 向运行中的会话发送消息（支持序号 / ID / title 模糊）
- `/harness-notice-user` — 发送通知消息
````

- [ ] **Step 2.2: 人工核对**

```bash
cat skills/harness-todo-list/SKILL.md
```

Expected: 表格首列是 `#`；含临时索引提示句；输出示例有序号列。

- [ ] **Step 2.3: Commit**

```bash
git add skills/harness-todo-list/SKILL.md
git commit -m "feat: add index column to harness-todo-list output"
```

---

## Task 3: 改 `harness-session-send-user-message` 接入新查找

**Files:**
- Modify: `skills/harness-session-send-user-message/SKILL.md`

- [ ] **Step 3.1: 重写 `skills/harness-session-send-user-message/SKILL.md`**

把整个文件替换为：

````markdown
---
name: harness-session-send-user-message
description: "Send a user message to an existing Claude Code session linked to a harness todo item. Uses tmux send-keys to deliver the message. Use when user wants to send instructions to a running harness session."
---

# Harness Session Send User Message

向指定待办项关联的 Claude Code 会话发送用户消息。

## 输入

- 待办项标识（接受三种形式）：
  - **纯数字** → `harness-todo-list` 表格里的序号（1-based）
  - **非纯数字** → 先按 ID 精确匹配；未命中再按 title 大小写不敏感 substring 模糊匹配
- 要发送的文本内容

## 处理流程

### 1. 首次查找

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.js';
import { lookupTodo, LookupError } from '<plugin-dir>/src/utils/lookup.js';
const store = new TodoStore(process.argv[1]);
const items = store.list();
try {
  const r = lookupTodo(process.argv[2], items);
  console.log(JSON.stringify(r));
} catch (e) {
  if (e instanceof LookupError) {
    console.error(JSON.stringify({ code: e.code, message: e.message }));
    process.exit(1);
  }
  throw e;
}
" "<cwd>" "<标识>"
```

stdout 是 JSON：
- `{"mode":"match","todo":{...}}` — 直接命中，跳到第 3 步
- `{"mode":"confirm","candidates":[{...}]}` — 模糊命中，进入第 2 步

stderr + 非零退出 → 把 `message` 字段直接展示给用户。

### 2. 候选确认（仅当 mode 为 confirm）

向用户输出候选表（候选列表里的 `#` 是该列表内的序号，与全局列表无关）：

```
未按 ID 精确匹配到待办项，以下是按 title 模糊匹配到的候选项：

| # | Title | ID | Status |
|---|-------|----|--------|
| 1 | 实现登录功能 | abc123def456 | 🔵 running |
| 2 | 登录页样式调整 | xyz789ghi012 | ⚪ pending |

请回复序号或完整 ID 以确认要发送的待办项。
```

收到用户回复后，用候选列表再次解析：

```bash
npx tsx -e "
import { resolveCandidate, LookupError } from '<plugin-dir>/src/utils/lookup.js';
const candidates = JSON.parse(process.argv[1]);
try {
  const todo = resolveCandidate(process.argv[2], candidates);
  console.log(JSON.stringify(todo));
} catch (e) {
  if (e instanceof LookupError) {
    console.error(JSON.stringify({ code: e.code, message: e.message }));
    process.exit(1);
  }
  throw e;
}
" '<candidates JSON>' "<用户回复>"
```

若再次失败，按 stderr 文案告知用户后终止；不再次进入模糊匹配，避免发散。

### 3. 发送消息

拿到 `todo` 后，按以下顺序校验并发送：

1. `todo.status !== 'running'` → 输出 `该会话未在运行（当前状态：<status>）` 并终止
2. `todo.tmuxSessionId` 为空 → 输出 `tmux 会话已关闭` 并终止
3. 调用：

```bash
tmux send-keys -t "<todo.tmuxSessionId>" '<用户输入的文本>' Enter
```

如果 tmux 命令本身报错（会话已不存在等），把 tmux 的 stderr 转给用户。

## 错误文案对照

| 场景 | 文案来源 |
|------|----------|
| 序号越界 / 候选序号越界 | `LookupError` `OUT_OF_RANGE` 的 message |
| 三路查找均未命中 | `LookupError` `NOT_FOUND` 的 message |
| 确认阶段无法定位 | `LookupError` `NOT_FOUND` 的 message |
| 状态不是 running | `该会话未在运行（当前状态：<status>）` |
| tmux 会话不存在 | `tmux 会话 <tmuxSessionId> 已关闭` 或 tmux stderr |
````

- [ ] **Step 3.2: 人工核对**

```bash
cat skills/harness-session-send-user-message/SKILL.md
```

Expected: 包含三段处理流程；候选表示例正确；引用了 `lookupTodo` / `resolveCandidate` / `LookupError`。

- [ ] **Step 3.3: 跑全量测试，确认无回归**

```bash
npm test
```

Expected: 全部 PASS

- [ ] **Step 3.4: Commit**

```bash
git add skills/harness-session-send-user-message/SKILL.md
git commit -m "feat: support index/id/fuzzy-title lookup in send-user-message"
```

---

## 手工验收

完成上述 3 个任务后，按 spec 的"测试计划"做一次手工验收：

1. `/harness-todo-list` 表格首列出现 `#`
2. `/harness-session-send-user-message 1 "<msg>"` 命中第 1 条
3. 用完整 nanoid → 精确命中
4. title 中间片段单命中 → 候选表 1 行 → 选 1 后发送成功
5. 多 title 共享关键词 → 候选表多行
6. 无意义字符串 → `NOT_FOUND` 错误
7. 序号 0 / 负数 / 超过长度 → `OUT_OF_RANGE` 错误
