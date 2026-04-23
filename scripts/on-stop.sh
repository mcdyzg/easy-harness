#!/bin/bash
# Stop hook —— 在 harness-* tmux 会话内 Claude 完成一轮时把通知派发给 dispatch 入口
# 所有失败 / 不适用情况均静默 exit 0，绝不影响主会话
#
# 性能约定（与旧版本的区别）：
#   旧：起一个新 tmux 会话跑 `claude -p` 让 LLM 识别并调用 harness-notice-user skill，
#       skill 内部又启动 4 次 `npx tsx`，再通过 runHooks 发起第二次 `claude -p`……
#       端到端 25–40s。
#   新：直接把上下文丢给 src/scripts/on-stop-dispatch.ts，一次 `npx tsx` 做完
#       「读 todo → 状态流转 → 读 transcript → 组 NoticeMessage → runHooks」。
#       端到端 3–5s。

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

# 6. CLAUDE_PLUGIN_ROOT 由 Claude Code 注入；缺失则静默退出
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  exit 0
fi

# 7. 异步派发：把剩下的活交给 dispatch 入口脚本
# 后台执行 + stdout/stderr 重定向，避免阻塞 Stop hook，也避免污染主会话
mkdir -p "${CLAUDE_PLUGIN_ROOT}/log" 2>/dev/null || true

# nohup + & 让子进程彻底脱离当前 shell（Claude Code 关 stdin 后不被 SIGHUP）
nohup npx --yes tsx "${CLAUDE_PLUGIN_ROOT}/src/scripts/on-stop-dispatch.ts" \
  "$CWD" "$TMUX_SESSION" "$TRANSCRIPT_PATH" \
  >>"${CLAUDE_PLUGIN_ROOT}/log/on-stop.out.log" \
  2>>"${CLAUDE_PLUGIN_ROOT}/log/on-stop.err.log" \
  </dev/null &

exit 0
