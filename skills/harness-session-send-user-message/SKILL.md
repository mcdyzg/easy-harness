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

1. **无条件将 `todo.status` 更新为 `running`**（无论当前状态是 pending/done/failed 还是已经是 running，都覆盖为 running，表示本次开始执行）：

   ```bash
   npx tsx -e "
   import { TodoStore } from '<plugin-dir>/src/store.ts';
   const store = new TodoStore(process.argv[1]);
   store.update(process.argv[2], { status: 'running' });
   " "<cwd>" "<todo.id>"
   ```

2. `todo.tmuxSessionId` 为空 → 输出 `tmux 会话已关闭` 并终止
3. 检测 tmux 会话是否实际存在（电脑重启等原因可能导致 tmux 会话丢失但记录未更新）：

```bash
tmux has-session -t "<todo.tmuxSessionId>" 2>/dev/null
```

- **退出码 0** → 会话存在，继续第 4 步
- **非零退出码** → 会话已丢失，进入第 3a 步（恢复流程）

#### 3a. 会话恢复

向用户提示并确认：

```
⚠️ tmux 会话 <tmuxSessionId> 已不存在（可能因电脑重启等原因丢失）。
是否重新创建会话并发送消息？(y/n)
```

- **用户拒绝** → 将 `todo.status` 更新为 `failed`，输出 `已将待办项状态标记为 failed` 并终止

  ```bash
  npx tsx -e "
  import { TodoStore } from '<plugin-dir>/src/store.ts';
  const store = new TodoStore(process.argv[1]);
  store.update(process.argv[2], { status: 'failed' });
  " "<cwd>" "<todo.id>"
  ```

- **用户确认** → 重新创建 tmux 会话：

  ```bash
  SESSION_NAME="<todo.claudeSessionName>"
  TMUX_NAME="<todo.tmuxSessionId>"
  tmux new-session -d -s "$TMUX_NAME" "claude -n '$SESSION_NAME' --remote-control '当前任务信息是：<todo.description>；当前待办项的id是<todo.id>'"
  ```

  等待 Claude Code 启动完成后（约 2-3 秒），继续第 4 步发送消息。

### 4. 执行发送

```bash
tmux send-keys -t "<todo.tmuxSessionId>" '<用户输入的文本>' Enter
```

如果 tmux 命令本身报错，把 tmux 的 stderr 转给用户。

## 错误文案对照

| 场景 | 文案来源 |
|------|----------|
| 序号越界 / 候选序号越界 | `LookupError` `OUT_OF_RANGE` 的 message |
| 三路查找均未命中 | `LookupError` `NOT_FOUND` 的 message |
| 确认阶段无法定位 | `LookupError` `NOT_FOUND` 的 message |
| tmux 会话记录为空 | `tmux 会话已关闭` |
| tmux 会话已丢失（重启等） | 提示用户是否恢复；拒绝则标记 failed |
| 发送时 tmux 报错 | tmux stderr |
