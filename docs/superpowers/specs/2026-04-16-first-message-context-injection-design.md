# 首次消息上下文注入

## 背景

用户通过 `harness-todo-create` 创建待办项时，Claude Code 子会话收到的初始 prompt 包含标题和描述。但当用户后续通过 `harness-session-send-user-message` 首次发送指令（如「开始执行」）时，子会话只看到简短的指令文本，缺少完整的任务上下文。

## 目标

在 `harness-session-send-user-message` 首次向某个待办项发送消息时，自动将待办项的核心信息（标题、描述、ID）作为前缀拼接到用户消息前面，让子会话有更充分的上下文。

## 设计

### 1. 数据层

`src/types.ts` — `TodoItem` 新增字段：

```typescript
firstMessageSent: boolean;
```

`harness-todo-create` 创建记录时初始值为 `false`。

向后兼容：已有 todos.json 中旧记录缺失该字段时，`buildFirstMessage` 将 `undefined`/falsy 均视为"未发送过"。

### 2. TS 工具层

新增 `src/services/message.ts`，导出纯函数 `buildFirstMessage`：

```typescript
import type { TodoItem } from '../types.ts';

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

- `firstMessageSent` 为 falsy → 拼接上下文前缀 + 用户消息
- `firstMessageSent` 为 truthy → 直接透传用户消息

### 3. SKILL.md 流程变更

#### harness-todo-create

步骤 2 创建记录时增加 `firstMessageSent: false`。

#### harness-session-send-user-message

在第 3 步（更新状态为 running）之后、第 4 步（tmux send-keys）之前，插入消息构建步骤：

**步骤 3.5（新增）— 构建最终消息**：

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

**第 4 步改为**使用上一步的 `finalMessage` 作为 send-keys 内容。

**第 4 步之后（新增）— 更新 firstMessageSent**：

仅当 tmux send-keys 成功（退出码 0）且 `todo.firstMessageSent` 为 falsy 时：

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

#### 会话恢复场景（3a）

恢复后重新创建的会话通过 `--remote-control` prompt 已包含任务描述，`firstMessageSent` 不需要重置。

## 改动清单

| 文件 | 改动 |
|------|------|
| `src/types.ts` | `TodoItem` 新增 `firstMessageSent: boolean` |
| `src/services/message.ts` | 新增文件，导出 `buildFirstMessage` |
| `skills/harness-todo-create/SKILL.md` | 步骤 2 添加 `firstMessageSent: false` |
| `skills/harness-session-send-user-message/SKILL.md` | 新增步骤 3.5 + 步骤 4 后更新逻辑 |
