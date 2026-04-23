# Easy Harness

Claude Code skill package for terminal-based todo management with tmux-backed Claude sessions.

## Requirements

- **tmux**（强依赖）：本插件所有会话管理、消息发送与通知钩子都基于 tmux 实现，使用前请确保已安装并可在 `PATH` 中调用。

  ```bash
  # macOS
  brew install tmux

  # Debian / Ubuntu
  sudo apt-get install tmux
  ```

## Installation

在 Claude Code 中通过 GitHub marketplace 安装：

```
/plugin marketplace add mcdyzg/easy-harness
/plugin install easy-harness@easy-harness-marketplace
```

或者克隆仓库后从本地路径安装：

```bash
git clone https://github.com/mcdyzg/easy-harness.git
```

然后在 Claude Code 中执行：

```
/plugin marketplace add <path-to-easy-harness>
/plugin install easy-harness@easy-harness-local
```

## Hook Setup

This plugin registers a `Stop` hook automatically via `hooks/hooks.json`. No manual `settings.json` configuration is required.

The hook fires when Claude finishes a turn inside a tmux session whose name starts with `harness-`. It dispatches a separate ephemeral tmux session that runs Claude with the `harness-notice-user` skill to generate and deliver a notification.

## Skills

- `/harness-todo-list` — Open the terminal todo management UI
- `/harness-todo-create` — Create a new todo from a description
- `/harness-todo-finish` — Mark a todo as done/failed, close its tmux session, keep the record
- `/harness-todo-remove` — Remove a todo and kill its tmux session
- `/harness-session-send-user-message` — Send a message to a running Claude session
- `/harness-notice-user` — Send a notification about a todo's status
- `/harness-todo-polling` — Start a background cron poller that serially wakes up running todos via tmux send-keys

## Customization

Easy Harness 的核心 skills 在关键流程节点预留了扩展钩子，通过 `.harness/config.json` 配置。

### 配置文件

在项目的 `.harness/config.json`（与 `todos.json` 同级）中添加 `hooks` 字段：

```json
{
  "hooks": {
    "todo-create": [
      {
        "type": "command",
        "command": "curl -X POST https://example.com/api/tasks -d @-"
      }
    ],
    "todo-finish": [
      {
        "type": "skill",
        "skill": "my-custom-finish-hook"
      }
    ],
    "notice-user": [
      {
        "type": "command",
        "command": "python3 ./scripts/send-feishu.py"
      }
    ]
  }
}
```

### Hook 类型

| type | 必填字段 | 说明 |
|------|----------|------|
| `command` | `command` | 执行 shell 命令，事件上下文通过 stdin JSON 传入 |
| `skill` | `skill` | 调用指定名称的 Claude Code skill，事件上下文作为参数传入 |

### 事件

| 事件名 | 触发时机 | 语义 |
|--------|----------|------|
| `todo-create` | 待办项创建完成后（记录已写入、tmux 会话已启动） | 追加增强（默认流程始终完整执行） |
| `todo-finish` | 待办项完成后（tmux 已关闭、状态已更新） | 追加增强（默认流程始终完整执行） |
| `notice-user` | 通知生成后 | 替代默认控制台输出（有配置走 hooks，无配置走控制台） |

### 执行规则

- 同一事件下多个 hook 按数组顺序逐个执行
- 单个 hook 失败不影响后续 hook
- 配置文件不存在或事件无配置时静默跳过

### Payload 示例

`todo-create` 和 `todo-finish` 的 stdin JSON：

```json
{
  "cwd": "/path/to/project",
  "id": "abc123",
  "title": "实现登录功能",
  "description": "用户描述...",
  "status": "running",
  "tmuxSessionId": "harness-abc123",
  "remoteControlUrl": "https://...",
  "claudeSessionId": "session_...",
  "claudeSessionName": "[HARNESS_SESSION]实现登录功能"
}
```

`notice-user` 的 stdin JSON：

```json
{
  "title": "实现登录功能",
  "status": "done",
  "userMessage": "帮我实现一下登录功能",
  "assistantMessage": "已完成登录功能的实现...",
  "tmuxSessionId": "harness-abc123",
  "remoteControlUrl": "https://..."
}
```

### Debug 日志

在 `.harness/config.json` 中设置 `"debug": true`，即可在 `.harness/debug.log`
追加记录 hooks、polling、scheduler、recovery、tmux、store、notice、session-log
各模块的结构化日志。日志为 **JSONL** 格式（一行一个 JSON 对象），每条包含
`ts`、`pid`、`module`、`event` 以及该事件特定的入参/命令/耗时/错误等字段，
方便 `jq .` 或 `grep` 过滤排查。关闭时零 I/O 开销。修改 config 后需重启
polling / scheduler 进程生效。日志无自动轮转，需自行 `rm` 清理。

示例：

```bash
# 看某个 todo 的所有事件
grep '"id":"abc"' .harness/debug.log | jq .

# 只看失败事件
jq -c 'select(.event | test("fail"))' .harness/debug.log

# 看某模块全部事件
jq -c 'select(.module == "polling")' .harness/debug.log
```

## Data

Todo items are stored in `.harness/todos.json` in the current working directory.
