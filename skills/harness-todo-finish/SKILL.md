---
name: harness-todo-finish
description: "Finish a harness todo item by ID. Marks the todo as done (or failed), kills its tmux session, and keeps the record for history. Use when user wants to complete/finish/mark-done a todo in the harness system, without deleting it."
---

# Harness Todo Finish

把指定待办项标记为已完成（或失败），并关闭其 tmux 会话。与 `harness-todo-remove` 的区别：**finish 保留记录**，只更新状态与清理运行时资源，方便日后回溯；**remove 则彻底删除**。

## 输入

- 待办项标识（接受三种形式）：
  - **纯数字** → `harness-todo-list` 表格里的序号（1-based）
  - **非纯数字** → 先按 ID 精确匹配；未命中再按 title 大小写不敏感 substring 模糊匹配
- 可选：最终状态提示。若用户原话中出现"失败 / 报错 / 异常 / 放弃 / 取消"等语义则记为 `failed`，否则默认 `done`。

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

请回复序号或完整 ID 以确认要完成的待办项。
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

### 3. 终态预检

拿到 `todo` 后，若当前 `status` 已经是 `done` 或 `failed`，提示用户 `该待办项已结束（状态：<status>）` 并询问是否仍需重新标记；得到确认再继续，否则终止。

### 4. 关闭 tmux 会话

`tmuxSessionId` 非空时才执行；用 `|| true` 兜底，避免会话已不存在时报错。

```bash
if [ -n "<tmuxSessionId>" ]; then
  tmux kill-session -t "<tmuxSessionId>" 2>/dev/null || true
fi
```

### 5. 更新记录状态

把 `status` 写为输入中解析出的最终态（`done` 或 `failed`）。保留其他字段（`tmuxSessionId`、`remoteControlUrl`、`claudeSessionId`、`claudeSessionName`）作为历史信息，方便后续回溯。

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.js';
const store = new TodoStore(process.argv[1]);
store.update(process.argv[2], { status: process.argv[3] });
" "<cwd>" "<todo-id>" "<finalStatus>"
```

### 6. 反馈

向用户输出一行确认，例如：

> 已完成待办项 `<title>`（id: `<id>`，状态：`<finalStatus>`），tmux 会话 `<tmuxSessionId>` 已关闭。

若步骤 4 跳过（`tmuxSessionId` 为空），则省略最后一段。

### 7. 触发扩展钩子（可选）

**不影响上述默认流程**。步骤 4–6 全部完成后，再额外判断：当前会话系统提示里"可用 skills 列表"中是否含 `harness-custom-todo-finish`。

- **若有**：调用 `harness-custom-todo-finish` skill，把已写入记录的完整字段作为参数传入 —— 至少包括 `cwd, id, title, description, status, tmuxSessionId, remoteControlUrl, claudeSessionId, claudeSessionName`（其中 `status` 已是最终态）。该 skill 只做**额外增强**（例如在远端任务系统里关单、在团队看板把卡片移到 Done 列、发送"任务已完成"通知等），不应回滚或修改已写入的核心字段。
- **若无**：什么也不做，直接结束。

注意：`harness-custom-todo-finish` 是"扩展钩子"而非"替换实现"，不存在时默认流程也能完整工作。

## 注意事项

- 与 `/harness-todo-remove` 的语义对比：finish 只改状态 + 关会话，保留记录；remove 会连记录一起抹掉。若用户意图模糊（例如只说"把 xxx 那个处理掉"），优先向用户确认究竟要 finish 还是 remove。
- 步骤 4「关闭 tmux 会话」是**不可逆**的：会话内 Claude Code 的运行上下文随之丢失。若记录当前状态为 `running` 且用户未明确要结束，应先提示确认再继续。

## 错误文案对照

| 场景 | 文案来源 |
|------|----------|
| 序号越界 / 候选序号越界 | `LookupError` `OUT_OF_RANGE` 的 message |
| 三路查找均未命中 | `LookupError` `NOT_FOUND` 的 message |
| 确认阶段无法定位 | `LookupError` `NOT_FOUND` 的 message |
| 待办项已是终态 | `该待办项已结束（状态：<status>）` |
| tmux 会话不存在 | tmux stderr（已被 `\|\| true` 静默兜底，可忽略） |
