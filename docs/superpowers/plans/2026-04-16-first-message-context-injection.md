# 首次消息上下文注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `harness-session-send-user-message` 首次向某个待办项发送消息时，自动拼接待办项上下文（标题、描述、ID）作为前缀，让子会话有更充分的信息。

**Architecture:** 在 `TodoItem` 上新增 `firstMessageSent: boolean` 字段追踪是否已发送过首次消息。新增 `src/services/message.ts` 导出纯函数 `buildFirstMessage`，根据该字段决定是否拼接上下文前缀。两个 SKILL.md 分别更新创建逻辑和发送逻辑。

**Tech Stack:** TypeScript, Vitest, tmux

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | `TodoItem` 新增 `firstMessageSent` 字段 |
| `src/services/message.ts` | Create | 导出 `buildFirstMessage` 纯函数 |
| `tests/services/message.test.ts` | Create | `buildFirstMessage` 单元测试 |
| `tests/store.test.ts` | Modify | `makeTodo` helper 补充新字段默认值 |
| `skills/harness-todo-create/SKILL.md` | Modify | 创建记录时增加 `firstMessageSent: false` |
| `skills/harness-session-send-user-message/SKILL.md` | Modify | 新增消息构建步骤 + 发送后更新字段 |

---

### Task 1: TodoItem 类型新增 `firstMessageSent` 字段

**Files:**
- Modify: `src/types.ts:1-12`
- Modify: `tests/store.test.ts:22-31`

- [ ] **Step 1: 在 TodoItem 接口新增字段**

在 `src/types.ts` 的 `TodoItem` 接口中，在 `claudeSessionName` 之后新增：

```typescript
firstMessageSent: boolean;
```

完整的 `TodoItem` 接口变为：

```typescript
export interface TodoItem {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  tmuxSessionId: string;
  remoteControlUrl: string;
  claudeSessionId: string;
  claudeSessionName: string;
  firstMessageSent: boolean;
}
```

- [ ] **Step 2: 更新 store.test.ts 的 makeTodo helper**

`tests/store.test.ts` 中的 `makeTodo` 函数需要补充新字段默认值，否则类型检查报错。将 `makeTodo` 改为：

```typescript
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
```

- [ ] **Step 3: 运行现有测试确认无破坏**

Run: `cd /Users/bytedance/haha/x/agent/claude-about/easy-harness && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/types.ts tests/store.test.ts
git commit -m "feat: TodoItem 新增 firstMessageSent 字段"
```

---

### Task 2: 实现 `buildFirstMessage` 函数 (TDD)

**Files:**
- Create: `tests/services/message.test.ts`
- Create: `src/services/message.ts`

- [ ] **Step 1: 编写失败的测试**

创建 `tests/services/message.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { buildFirstMessage } from "../../src/services/message.js";
import type { TodoItem } from "../../src/types.js";

const makeTodo = (overrides: Partial<TodoItem> = {}): TodoItem => ({
  id: "abc123def456",
  title: "实现登录功能",
  description: "使用 JWT 实现用户登录注册",
  status: "running",
  tmuxSessionId: "harness-abc123def456",
  remoteControlUrl: "",
  claudeSessionId: "",
  claudeSessionName: "[HARNESS_SESSION]实现登录功能",
  firstMessageSent: false,
  ...overrides,
});

describe("buildFirstMessage", () => {
  it("首次消息拼接上下文前缀", () => {
    const todo = makeTodo({ firstMessageSent: false });
    const result = buildFirstMessage(todo, "开始执行");

    expect(result).toContain("【待办项上下文】");
    expect(result).toContain("- 标题：实现登录功能");
    expect(result).toContain("- 描述：使用 JWT 实现用户登录注册");
    expect(result).toContain("- 待办项 ID：abc123def456");
    expect(result).toContain("以下是用户指令：");
    expect(result).toContain("开始执行");
  });

  it("非首次消息直接透传", () => {
    const todo = makeTodo({ firstMessageSent: true });
    const result = buildFirstMessage(todo, "继续执行下一步");

    expect(result).toBe("继续执行下一步");
  });

  it("firstMessageSent 为 undefined 时视为首次（向后兼容）", () => {
    const todo = makeTodo();
    // 模拟旧记录缺失该字段
    (todo as any).firstMessageSent = undefined;
    const result = buildFirstMessage(todo, "开始");

    expect(result).toContain("【待办项上下文】");
    expect(result).toContain("开始");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/bytedance/haha/x/agent/claude-about/easy-harness && npx vitest run tests/services/message.test.ts`
Expected: FAIL — 找不到 `../../src/services/message.js` 模块

- [ ] **Step 3: 实现 buildFirstMessage**

创建 `src/services/message.ts`：

```typescript
import type { TodoItem } from "../types.js";

export function buildFirstMessage(todo: TodoItem, userMessage: string): string {
  if (todo.firstMessageSent) {
    return userMessage;
  }

  return `【待办项上下文】
- 标题：${todo.title}
- 描述：${todo.description}
- 待办项 ID：${todo.id}

---
以下是用户指令：
${userMessage}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/bytedance/haha/x/agent/claude-about/easy-harness && npx vitest run tests/services/message.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: 运行全量测试确认无破坏**

Run: `cd /Users/bytedance/haha/x/agent/claude-about/easy-harness && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/message.ts tests/services/message.test.ts
git commit -m "feat: 实现 buildFirstMessage 首次消息上下文拼接"
```

---

### Task 3: 更新 harness-todo-create SKILL.md

**Files:**
- Modify: `skills/harness-todo-create/SKILL.md:26-43`

- [ ] **Step 1: 在步骤 2 的 store.add 调用中新增字段**

在 `skills/harness-todo-create/SKILL.md` 的步骤 2 代码块中，`claudeSessionName: '',` 之后添加 `firstMessageSent: false,`。

修改后的代码块为：

````markdown
```bash
npx tsx -e "
import { generateId } from '<plugin-dir>/src/utils/id.ts';
import { TodoStore } from '<plugin-dir>/src/store.ts';
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
  firstMessageSent: false,
});
console.log(id);
" "<cwd>" "<title>" "<description>"
```
````

- [ ] **Step 2: Commit**

```bash
git add skills/harness-todo-create/SKILL.md
git commit -m "feat: harness-todo-create 创建时初始化 firstMessageSent 为 false"
```

---

### Task 4: 更新 harness-session-send-user-message SKILL.md

**Files:**
- Modify: `skills/harness-session-send-user-message/SKILL.md:83-153`

- [ ] **Step 1: 在第 3 步和第 4 步之间插入新的步骤 3.5**

在 `skills/harness-session-send-user-message/SKILL.md` 中，在「3a. 会话恢复」小节结束之后、「4. 执行发送」之前，插入以下内容：

````markdown
### 3.5 构建最终消息

根据 `todo.firstMessageSent` 决定是否在用户消息前拼接待办项上下文：

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
import { buildFirstMessage } from '<plugin-dir>/src/services/message.ts';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
const finalMessage = buildFirstMessage(todo, process.argv[3]);
console.log(finalMessage);
" "<cwd>" "<todo.id>" "<用户输入的文本>"
```

stdout 即为最终要发送的消息（`finalMessage`）。如果是首次发送，会自动拼接待办项标题、描述、ID 作为上下文前缀；非首次则直接透传用户原始文本。
````

- [ ] **Step 2: 修改第 4 步，使用 finalMessage**

将第 4 步「执行发送」的 tmux send-keys 命令改为使用步骤 3.5 输出的 `finalMessage`：

````markdown
### 4. 执行发送

```bash
tmux send-keys -t "<todo.tmuxSessionId>" '<finalMessage>' Enter
```

如果 tmux 命令本身报错，把 tmux 的 stderr 转给用户。
````

- [ ] **Step 3: 在第 4 步之后新增步骤 5 — 更新 firstMessageSent**

在第 4 步之后、「错误文案对照」表之前，新增：

````markdown
### 5. 更新首次发送标记

仅当第 4 步 tmux send-keys 成功（退出码 0）且 `todo.firstMessageSent` 为 falsy 时执行：

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (!todo.firstMessageSent) {
  store.update(process.argv[2], { firstMessageSent: true });
}
" "<cwd>" "<todo.id>"
```

若 `todo.firstMessageSent` 已为 `true`，跳过此步骤。
````

- [ ] **Step 4: Commit**

```bash
git add skills/harness-session-send-user-message/SKILL.md
git commit -m "feat: send-user-message 首次发送时注入待办项上下文"
```

---

### Task 5: 端到端验证

- [ ] **Step 1: 运行全量测试**

Run: `cd /Users/bytedance/haha/x/agent/claude-about/easy-harness && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 2: TypeScript 类型检查**

Run: `cd /Users/bytedance/haha/x/agent/claude-about/easy-harness && npx tsc --noEmit`
Expected: 无错误
