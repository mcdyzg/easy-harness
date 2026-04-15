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
tmux new-session -d -s "$TMUX_NAME" "claude -n '$SESSION_NAME' --remote-control '当前任务信息是：<description>；当前待办项的id是<id>'"
```

### 4. 记录会话信息

启动后，需要获取并记录以下信息到待办项：
- `tmuxSessionId`: 即 `harness-<id>`
- `remoteControlUrl`: 从 Claude 启动输出中获取 remote-control URL
- `claudeSessionId`: Claude Code 的 session ID
- `claudeSessionName`: 即 `[HARNESS_SESSION]<title>`
- 将状态更新为 `running`

使用 Bash 更新记录：

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
const store = new TodoStore(process.argv[1]);
store.update(process.argv[2], {
  status: 'running',
  tmuxSessionId: process.argv[3],
  remoteControlUrl: process.argv[4],
  claudeSessionId: process.argv[5],
  claudeSessionName: process.argv[6],
});
" "<cwd>" "<id>" "<tmuxSessionId>" "<remoteControlUrl>" "<claudeSessionId>" "<claudeSessionName>"
```

### 5. 触发扩展钩子（可选）

**不影响上述默认流程**。上面步骤 2–4 全部完成后，再额外判断：当前会话系统提示里"可用 skills 列表"中是否含 `harness-custom-todo-create`。

- **若有**：调用 `harness-custom-todo-create` skill，把已写入记录的完整字段作为参数传入 —— 至少包括 `cwd, id, title, description, status, tmuxSessionId, remoteControlUrl, claudeSessionId, claudeSessionName`。该 skill 只做**额外增强**（例如同步到远端任务系统、推送创建通知、补写自定义元数据等），不应回滚或修改已写入的核心字段。
- **若无**：什么也不做，直接结束。

注意：`harness-custom-todo-create` 是"扩展钩子"而非"替换实现"，不存在时默认流程也能完整工作。
