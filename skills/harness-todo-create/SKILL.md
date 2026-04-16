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
});
console.log(id);
" "<cwd>" "<title>" "<description>"
```

### 3. 启动 Claude Code 会话

```bash
SESSION_NAME="[HARNESS_SESSION]<title>"
TMUX_NAME="harness-<id>"
tmux new-session -d -s "$TMUX_NAME" "claude -n '$SESSION_NAME' --remote-control '当前被分配了以下任务：
- 标题：<title>
- 描述：<description>
后续根据用户指令完成任务。待办项的id是<id>'"
```

### 4. 记录会话信息

启动后，需要获取并记录以下信息到待办项：
- `tmuxSessionId`: 即 `harness-<id>`
- `remoteControlUrl`: 用 `tmux capture-pane -t harness-<id> -p` 读启动输出，取其中 `https://claude.ai/code/session_...` 那一行
- `claudeSessionName`: 即 `[HARNESS_SESSION]<title>`
- 将状态更新为 `running`

> **关于 `claudeSessionId`**：不要在此步骤尝试捕获它。父会话无法可靠拿到 spawn 出来的 Claude 的本地 session UUID（JSONL 刚启动时尚未落盘，且父会话自己也在同一目录写 jsonl，「挑最新的」会挑错）。插件自带的 `SessionStart` hook（`scripts/on-session-start.sh`）会在新 Claude 会话启动时从 tmux 会话名 `harness-<id>` 反推 todoId，并把 `session_id` 自动回填到记录里。这里 **留空即可**。

使用 Bash 更新记录：

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
const store = new TodoStore(process.argv[1]);
store.update(process.argv[2], {
  status: 'running',
  tmuxSessionId: process.argv[3],
  remoteControlUrl: process.argv[4],
  claudeSessionName: process.argv[5],
});
" "<cwd>" "<id>" "<tmuxSessionId>" "<remoteControlUrl>" "<claudeSessionName>"
```

### 5. 触发扩展钩子（可选）

**不影响上述默认流程**。上面步骤 2–4 全部完成后，再额外执行 `.harness/config.json` 中 `todo-create` 事件配置的 hooks。

先重新读取记录（`TodoStore.get(id)`）拿到当前快照——由于 `claudeSessionId` 由 SessionStart hook 异步回填，直接用步骤 4 的入参可能拿到空字符串；读一次记录可以尽量拿到最新值。

```bash
npx --yes tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
import { runHooks } from '<plugin-dir>/src/services/hooks.ts';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (todo) {
  await runHooks(process.argv[1], 'todo-create', { cwd: process.argv[1], ...todo });
}
" "<cwd>" "<id>"
```

若 `.harness/config.json` 不存在或 `todo-create` 事件无配置，静默跳过，不影响默认流程。
