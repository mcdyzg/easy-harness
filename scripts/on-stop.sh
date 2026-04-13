#!/bin/bash
# Stop hook —— 在 harness-* tmux 会话内 Claude 完成一轮时派发通知会话
# 所有失败 / 不适用情况均静默 exit 0，绝不影响主会话

set -u

# 1. 必须在 tmux 内
if [ -z "${TMUX:-}" ]; then
  exit 0
fi

# 2. tmux session 必须以 harness- 开头（限定范围 + 防递归）
TMUX_SESSION=$(tmux display-message -p '#S' 2>/dev/null || echo "")
case "$TMUX_SESSION" in
  harness-*) ;;
  *) exit 0 ;;
esac

# 3. 读 stdin JSON
INPUT=$(cat)

# 4. 防 Stop 套 Stop
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

# 5. 拿 cwd / transcript_path
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
if [ -z "$CWD" ]; then
  exit 0
fi

# 6. 从 tmux session 名查 todoId
TODO_ID=$(npx --yes tsx -e "
  import { TodoStore } from '${CLAUDE_PLUGIN_ROOT}/src/store.ts';
  const store = new TodoStore(process.argv[1]);
  const todo = store.list().find(t => t.tmuxSessionId === process.argv[2]);
  if (todo) console.log(todo.id);
" "$CWD" "$TMUX_SESSION" 2>/dev/null)

if [ -z "$TODO_ID" ]; then
  exit 0
fi

# 7. 派发通知会话（名字不以 harness- 开头，避免 hook 递归触发）
TS=$(date +%s)
NOTICE_SESSION="notice-${TODO_ID}-${TS}"
PROMPT="调用 harness-notice-user skill。todoId=${TODO_ID}，cwd=${CWD}，transcriptPath=${TRANSCRIPT_PATH}，pluginRoot=${CLAUDE_PLUGIN_ROOT}。执行完后直接退出，不要等待用户输入。"

tmux new-session -d -s "$NOTICE_SESSION" -c "$CWD" \
  "claude -p $(printf '%q' "$PROMPT")" 2>>"${CLAUDE_PLUGIN_ROOT}/log/on-stop.err.log" || true

exit 0
