---
name: harness-session-send-user-message
description: "Send a user message to an existing Claude Code session linked to a harness todo item. Uses tmux send-keys to deliver the message. Use when user wants to send instructions to a running harness session."
---

# Harness Session Send User Message

向指定待办项关联的 Claude Code 会话发送用户消息。

## 输入

- 待办项 ID
- 要发送的文本内容

## 处理流程

### 1. 查找待办项

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.js';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (!todo) { console.error('待办项不存在'); process.exit(1); }
console.log(JSON.stringify({ tmuxSessionId: todo.tmuxSessionId, status: todo.status }));
" "<cwd>" "<todo-id>"
```

### 2. 发送消息

确认待办项状态为 `running` 后，通过 tmux send-keys 发送消息：

```bash
tmux send-keys -t "<tmuxSessionId>" '<用户输入的文本>' Enter
```

### 3. 错误处理

- 如果待办项不存在，告知用户
- 如果待办项状态不是 `running`，告知用户该会话未在运行
- 如果 tmux 会话不存在，告知用户会话已关闭
