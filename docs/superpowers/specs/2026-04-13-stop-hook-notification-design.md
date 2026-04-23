# Stop Hook 自动通知设计

> ⚠️ **Superseded by 0.1.31 (on-stop-dispatch.ts)** — 本文档描述的是"派发独立 `claude -p` 会话 → 调 `harness-notice-user` skill"的老链路。0.1.31 起 Stop hook 直接后台运行 `src/scripts/on-stop-dispatch.ts` 一次性完成读 todo / 读 transcript / 组 payload / 调 `runHooks`，不再经过任何新 Claude 会话。端到端耗时从 25–40s 降至 3–5s。本文档保留作历史参考。

## 目标

当 harness 管理的 tmux 会话里 Claude 完成一轮响应（Stop 事件）时，自动派发一个独立的临时 Claude 会话，调用 `harness-notice-user` skill 生成并发送通知。

## 背景

当前插件已有：
- `harness-notice-user` skill —— 由 Claude 执行的通知生成 + 发送 skill
- `hook/on-session-end.sh` —— 一个未注册的、仅 echo todoId 的脚本（要删除）

缺失：
- 没有 `hooks.json`，hook 没有真正注册到 Claude Code
- 没有把 Stop 事件桥接到 skill 的机制

参考 `claude-code-warp` 插件的 `hooks/hooks.json` + `${CLAUDE_PLUGIN_ROOT}/scripts/...` 模式做实现。

## 架构

```
┌───────────────────────────────────────────────┐
│ tmux session: harness-<todoId>                │
│ ┌───────────────────────────────────────────┐ │
│ │ claude (主会话，正在做 todo 任务)         │ │
│ │   ↓ 完成一轮，触发 Stop hook              │ │
│ └───────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
                 ↓ on-stop.sh
                 ↓ 检查前缀 / 防重入 / 查 todoId
                 ↓ tmux new-session -d
                 ↓
┌───────────────────────────────────────────────┐
│ tmux session: notice-<todoId>-<ts>            │
│ ┌───────────────────────────────────────────┐ │
│ │ claude -p "调用 harness-notice-send-      │ │
│ │            message skill, todoId=...,     │ │
│ │            cwd=..., transcriptPath=..."   │ │
│ │   ↓ 执行 skill                            │ │
│ │   ↓ 读 .harness/todos.json + transcript   │ │
│ │   ↓ 生成摘要 + 发通知                     │ │
│ │   ↓ 退出 → tmux session 自动销毁          │ │
│ └───────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

防递归的关键点：
- 通知会话名以 `notice-` 开头（**不**以 `harness-` 开头），所以它内部 Claude 触发的 Stop 不会再次满足前缀检查
- 主会话内多轮触发也不会嵌套，靠 stdin 的 `stop_hook_active` 字段拦截

## 文件改动

### 新增

- `hooks/hooks.json` —— 在插件根声明 Stop hook
- `scripts/on-stop.sh` —— Stop 事件处理脚本

### 删除

- `hook/on-session-end.sh` —— 文件名与实际行为不符，从未被注册

### 修改

- `skills/harness-notice-user/SKILL.md` —— 优化输入参数与执行约束（详见下文）

### `hooks/hooks.json`

```json
{
  "description": "Easy Harness session notifications",
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.sh"
          }
        ]
      }
    ]
  }
}
```

### `scripts/on-stop.sh`

```bash
#!/bin/bash
# Stop hook —— 在 harness 会话内 Claude 完成一轮时派发通知会话

# 1. 必须在 tmux 内
[ -z "$TMUX" ] && exit 0

# 2. tmux session 必须以 harness- 开头（防递归 + 限定范围）
TMUX_SESSION=$(tmux display-message -p '#S')
[[ "$TMUX_SESSION" != harness-* ]] && exit 0

# 3. 读 stdin JSON
INPUT=$(cat)

# 4. 防 Stop 套 Stop
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$STOP_ACTIVE" = "true" ] && exit 0

# 5. 从 stdin 拿 cwd + transcript_path
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
[ -z "$CWD" ] && exit 0

# 6. 从 tmux session 名查 todoId
TODO_ID=$(npx tsx -e "
  import { TodoStore } from '${CLAUDE_PLUGIN_ROOT}/src/store.js';
  const store = new TodoStore(process.argv[1]);
  const todo = store.list().find(t => t.tmuxSessionId === process.argv[2]);
  if (todo) console.log(todo.id);
" "$CWD" "$TMUX_SESSION" 2>/dev/null)

[ -z "$TODO_ID" ] && exit 0

# 7. 派发通知会话（名字不以 harness- 开头）
TS=$(date +%s)
NOTICE_SESSION="notice-${TODO_ID}-${TS}"
PROMPT="调用 harness-notice-user skill。todoId=${TODO_ID}，cwd=${CWD}，transcriptPath=${TRANSCRIPT_PATH}。执行完后直接退出，不要等待用户输入。"

tmux new-session -d -s "$NOTICE_SESSION" -c "$CWD" \
  "claude -p $(printf '%q' "$PROMPT")"

exit 0
```

## Skill 优化（`harness-notice-user`）

### 输入扩展

旧：`待办项 ID`
新：
- `todoId` —— 待办项 ID
- `cwd` —— 待办项所在工作目录（用于定位 `.harness/todos.json`）
- `transcriptPath` —— 当前 Claude 会话的 transcript JSONL 文件绝对路径（hook 直接传入）

### 主要修改点

| 项 | 改动 |
|---|---|
| `<plugin-dir>` 占位符 | 全部替换为 `${CLAUDE_PLUGIN_ROOT}`，skill 执行时该环境变量可用 |
| 会话日志查找 | 不再用 `findSessionLogFile(claudeSessionId)`，直接用 hook 传入的 `transcriptPath` 调 `getLastConversationTurn` |
| 摘要约束 | 明确：中文、单段、50–100 字、突出本轮"做了什么 / 等待什么"，不含代码块 |
| 状态字段 | `TodoItem.status` 已存在（`pending\|running\|done\|failed`），直接读取，不需要新造 |
| 自定义渠道判断 | 改成"如果系统提示的 skills 列表里出现 `harness-custom-notice-user`，则调用它；否则用默认 `formatNoticeMessage`" |
| 退出语义 | skill 末尾明确：发送完成后直接结束响应（`claude -p` 跑完即退） |

### 优化后的输入/流程描述（伪代码骨架，最终写进 SKILL.md）

```
输入：
  - todoId
  - cwd
  - transcriptPath

流程：
  1. 用 TodoStore(cwd) 读 todoId 对应的 TodoItem
  2. 用 getLastConversationTurn(transcriptPath) 取最后一轮对话
  3. 基于 user + assistant 文本生成 50–100 字中文摘要
  4. 组装 NoticeMessage：
       title, status (从 TodoItem.status), summary, tmuxSessionId, remoteControlUrl
  5. 若可用 skills 含 harness-custom-notice-user：调用之
     否则：调用 formatNoticeMessage 并 console.log
  6. 退出
```

## 错误处理

所有 hook 内部失败都静默返回（`exit 0`），不影响主会话。具体场景：

- 不在 tmux / 不是 harness 会话 → exit 0
- todoId 找不到 → exit 0（说明 tmux 名虽符合前缀但不是这个工作目录管理的）
- `tmux new-session` 失败 → exit 0（极少见，比如重名碰撞，下次 Stop 时间戳就变了）
- skill 内部失败 → 仅影响该次通知，不影响主会话

## 测试

可以验证的关键路径：
1. 单元：`scripts/on-stop.sh` 在各种 stdin / 环境组合下的早退行为（mock `$TMUX` / `tmux display-message` / stdin JSON）
2. 集成：手动起一个 `harness-test` tmux 会话，跑 claude，Stop 之后能看到 `tmux ls` 里出现 `notice-<id>-<ts>` 会话
3. skill：单独用 `claude -p "调用 harness-notice-user skill, todoId=xxx, cwd=xxx, transcriptPath=xxx"` 验证能跑通并产出通知文本

## 非目标

- 不处理 SessionEnd（仅 Stop）
- 不做通知重试 / 持久化队列
- 不实现 `harness-custom-notice-user`（skill 检测到则调用，没有就走默认）
- 不修改 README hook 安装说明（hooks.json 自动注册后 README 段落需要后续单独清理；此 spec 只负责机制本身）
