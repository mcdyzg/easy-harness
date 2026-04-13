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

# 6. 后续：查 todoId、派发通知会话（Task 4 实现）
exit 0
