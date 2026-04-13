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
