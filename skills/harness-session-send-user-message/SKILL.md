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
import { TodoStore } from '<plugin-dir>/src/store.ts';
import { lookupTodo, LookupError } from '<plugin-dir>/src/utils/lookup.ts';
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
import { resolveCandidate, LookupError } from '<plugin-dir>/src/utils/lookup.ts';
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

拿到 `todo` 后，按以下顺序处理：

1. **无条件将 `todo.status` 更新为 `running`**：

   ```bash
   npx tsx -e "
   import { TodoStore } from '<plugin-dir>/src/store.ts';
   const store = new TodoStore(process.argv[1]);
   store.update(process.argv[2], { status: 'running' });
   " "<cwd>" "<todo.id>"
   ```

2. `todo.tmuxSessionId` 为空 → 输出 `tmux 会话已关闭` 并终止。

3. 自动确保 tmux 会话活着（丢失则自动 resume / 全新 spawn）：

   ```bash
   npx tsx -e "
   import { TodoStore } from '<plugin-dir>/src/store.ts';
   import { ensureSessionAlive, createDefaultDeps } from '<plugin-dir>/src/services/recovery.ts';
   const store = new TodoStore(process.argv[1]);
   const todo = store.get(process.argv[2]);
   if (!todo) { console.error('todo not found'); process.exit(1); }
   ensureSessionAlive(process.argv[1], todo, createDefaultDeps(process.argv[1]));
   " "<cwd>" "<todo.id>"
   ```

   - 退出码 0 → 会话可用，继续第 4 步
   - 非零退出 → 把 stderr 里 `ensureSessionAlive` 抛出的信息直接展示给用户；不再自动改 `status` 为 failed（由用户决定下一步）

### 4. 构建消息并发送

在脚本内部完成消息构建和 tmux 发送，避免中间环节引入额外字符：

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
import { buildFirstMessage } from '<plugin-dir>/src/services/message.ts';
import { sendKeysToSession } from '<plugin-dir>/src/services/tmux.ts';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
const finalMessage = buildFirstMessage(todo, process.argv[3]);
sendKeysToSession(todo.tmuxSessionId, finalMessage);
" "<cwd>" "<todo.id>" "<用户输入的文本>"
```

如果是首次发送（`todo.firstMessageSent` 为 falsy），会自动拼接待办项标题、描述、ID 作为上下文前缀；非首次则直接透传用户原始文本。

如果脚本报错，把 stderr 转给用户。

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

## 错误文案对照

| 场景 | 文案来源 |
|------|----------|
| 序号越界 / 候选序号越界 | `LookupError` `OUT_OF_RANGE` 的 message |
| 三路查找均未命中 | `LookupError` `NOT_FOUND` 的 message |
| 确认阶段无法定位 | `LookupError` `NOT_FOUND` 的 message |
| tmux 会话记录为空 | `tmux 会话已关闭` |
| tmux 会话已丢失（重启等） | 自动恢复；恢复失败时把 `ensureSessionAlive` 的错误原样展示 |
| 发送时 tmux 报错 | tmux stderr |
