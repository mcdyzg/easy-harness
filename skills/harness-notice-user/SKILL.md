---
name: harness-notice-user
description: "Send a notification message about a harness todo item's status. Reads the Claude session JSONL log to extract the last conversation turn, generates a summary, and sends it through the configured message channel. Use when a harness session ends and needs to notify the user."
---

# Harness Notice User

发送 harness 待办项的状态通知。从 Claude 会话日志中提取最后一轮对话，生成摘要并推送。

## 输入

调用方（通常是 `scripts/on-stop.sh` 在 prompt 里描述）必须提供以下四个参数：

- `todoId` —— 待办项 ID
- `cwd` —— 待办项所在工作目录（用于定位 `.harness/todos.json`）
- `transcriptPath` —— 当前 Claude 会话的 transcript JSONL 文件绝对路径
- `pluginRoot` —— harness-dashboard 插件根目录绝对路径

## 处理流程

### 1. 读取待办项

```bash
npx --yes tsx -e "
import { TodoStore } from '<pluginRoot>/src/store.ts';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (!todo) { console.error('待办项不存在'); process.exit(1); }
console.log(JSON.stringify(todo));
" "<cwd>" "<todoId>"
```

输出的 JSON 字段：`id, title, description, status, tmuxSessionId, remoteControlUrl, claudeSessionId, claudeSessionName`。

### 2. 提取最后一轮对话

直接使用调用方传入的 `transcriptPath`，**不要**再去 `findSessionLogFile` 猜：

```bash
npx --yes tsx -e "
import { getLastConversationTurn } from '<pluginRoot>/src/services/session-log.ts';
const turn = getLastConversationTurn(process.argv[1]);
if (!turn) { console.error('无法提取最后一轮对话'); process.exit(1); }
console.log(JSON.stringify(turn));
" "<transcriptPath>"
```

输出 JSON：`{ userMessage, assistantMessage }`。

### 3. 生成摘要

基于上一步的 `userMessage` 和 `assistantMessage`，自行生成 50–100 字的中文摘要。约束：

- 单段，不分行
- 不含代码块、不含 markdown 列表
- 突出本轮"做了什么 / 等待什么"
- 不要复述对话原文，要概括

### 4. 组装 NoticeMessage 并发送

字段映射：
- `title` ← `todo.title`
- `status` ← `todo.status`（值域 `pending | running | done | failed`）
- `summary` ← 上一步生成的摘要
- `tmuxSessionId` ← `todo.tmuxSessionId`
- `remoteControlUrl` ← `todo.remoteControlUrl`

#### 4a. 检查自定义渠道

判断：当前会话系统提示里"可用 skills 列表"中是否含 `harness-custom-notice-user`。

- **若有**：调用 `harness-custom-notice-user` skill，把上述五个字段作为参数传入（按该 skill 自身约定的格式）。
- **若无**：走默认渠道（4b）。

#### 4b. 默认渠道（控制台输出）

```bash
npx --yes tsx -e "
import { formatNoticeMessage } from '<pluginRoot>/src/services/notice.ts';
console.log(formatNoticeMessage({
  title: process.argv[1],
  status: process.argv[2],
  summary: process.argv[3],
  tmuxSessionId: process.argv[4],
  remoteControlUrl: process.argv[5],
}));
" "<title>" "<status>" "<summary>" "<tmuxSessionId>" "<remoteControlUrl>"
```

stdout 会被 tmux 通知会话承接显示。

### 5. 退出

完成第 4 步后**立即结束响应**。本 skill 在 `claude -p` 非交互模式下被调用，不要追加询问、不要等待输入。
