---
name: harness-notice-send-message
description: "Send a notification message about a harness todo item's status. Reads the Claude session JSONL log to extract the last conversation turn, generates a summary, and sends it through the configured message channel. Use when a harness session ends and needs to notify the user."
---

# Harness Notice Send Message

发送待办项状态通知。从 Claude 会话日志中提取最后一轮对话，生成摘要并推送。

## 输入

- 待办项 ID

## 处理流程

### 1. 读取待办项信息

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.js';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (!todo) { console.error('待办项不存在'); process.exit(1); }
console.log(JSON.stringify(todo));
" "<cwd>" "<todo-id>"
```

### 2. 提取最后一轮对话

```bash
npx tsx -e "
import { findSessionLogFile, getLastConversationTurn } from '<plugin-dir>/src/services/session-log.js';
const file = findSessionLogFile(process.argv[1]);
if (!file) { console.error('未找到会话日志'); process.exit(1); }
const turn = getLastConversationTurn(file);
console.log(JSON.stringify(turn));
" "<claudeSessionId>"
```

### 3. 生成摘要

根据提取到的最后一轮 user 消息和 assistant 消息，生成一段简短的摘要（50-100 字）。

### 4. 发送通知

将以下信息组装为通知消息：
- 待办项标题
- 待办项状态
- 上一步生成的摘要
- tmux 对话 ID
- remote-control URL

当前使用 console 输出。后续可扩展为飞书/Telegram 等推送渠道，通过实现 `MessageSender` 接口。

```bash
npx tsx -e "
import { formatNoticeMessage } from '<plugin-dir>/src/services/notice.js';
console.log(formatNoticeMessage({
  title: process.argv[1],
  status: process.argv[2],
  summary: process.argv[3],
  tmuxSessionId: process.argv[4],
  remoteControlUrl: process.argv[5],
}));
" "<title>" "<status>" "<summary>" "<tmuxSessionId>" "<remoteControlUrl>"
```
