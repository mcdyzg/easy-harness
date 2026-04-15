#!/bin/bash
# SessionStart hook —— spawn 出来的 harness-* Claude 启动后，把自身 session_id 回写到 todo 记录
# 所有失败 / 不适用情况均静默 exit 0，绝不影响主会话

set -u

# 1. 必须在 tmux 内
if [ -z "${TMUX:-}" ]; then
  exit 0
fi

# 2. tmux session 必须以 harness- 开头（限定范围）
TMUX_SESSION=$(tmux display-message -p '#S' 2>/dev/null || echo "")
case "$TMUX_SESSION" in
  harness-*) ;;
  *) exit 0 ;;
esac

# 3. 从 tmux 会话名还原 todoId —— 不依赖 .harness/todos.json 里的 tmuxSessionId 字段，
#    避开父进程「先写 pending 记录、再补 tmuxSessionId」的竞态
TODO_ID="${TMUX_SESSION#harness-}"
if [ -z "$TODO_ID" ]; then
  exit 0
fi

# 4. 读 stdin JSON
INPUT=$(cat)

# 5. 拿 session_id / cwd
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
if [ -z "$SESSION_ID" ] || [ -z "$CWD" ]; then
  exit 0
fi

# 6. CLAUDE_PLUGIN_ROOT 由 Claude Code 注入；缺失时静默退出，避免 set -u 直接炸
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  exit 0
fi

# 7. 更新 todo 记录（已填过就跳过，避免 /clear 等二次 SessionStart 覆盖旧值）
mkdir -p "${CLAUDE_PLUGIN_ROOT}/log" 2>/dev/null || true
npx --yes tsx -e "
  import { TodoStore } from '${CLAUDE_PLUGIN_ROOT}/src/store.ts';
  const store = new TodoStore(process.argv[1]);
  const todo = store.get(process.argv[2]);
  if (!todo) process.exit(0);
  if (todo.claudeSessionId) process.exit(0);
  store.update(process.argv[2], { claudeSessionId: process.argv[3] });
" "$CWD" "$TODO_ID" "$SESSION_ID" 2>>"${CLAUDE_PLUGIN_ROOT}/log/on-session-start.err.log" || true

exit 0
