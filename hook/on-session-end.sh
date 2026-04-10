#!/bin/bash
# Harness Dashboard — 会话结束 hook
# 检测是否为 harness 管理的会话，若是则触发通知

# 获取当前 tmux 会话名称（如果在 tmux 中）
if [ -z "$TMUX" ]; then
  exit 0
fi

TMUX_SESSION_NAME=$(tmux display-message -p '#S')

# 检查是否为 harness 管理的会话（以 harness- 为前缀）
if [[ "$TMUX_SESSION_NAME" != harness-* ]]; then
  exit 0
fi

CWD="${1:-.}"

# 从 todos.json 中查找对应的待办项 ID
TODO_ID=$(npx tsx -e "
import { TodoStore } from '$(dirname "$0")/../src/store.js';
const store = new TodoStore(process.argv[1]);
const todos = store.list();
const todo = todos.find(t => t.tmuxSessionId === process.argv[2]);
if (todo) console.log(todo.id);
" "$CWD" "$TMUX_SESSION_NAME")

if [ -z "$TODO_ID" ]; then
  exit 0
fi

echo "harness:session-end:$TODO_ID"
