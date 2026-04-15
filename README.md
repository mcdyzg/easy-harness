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

Easy Harness 的核心 skills 在关键流程节点都预留了 **`harness-custom-*`** 扩展钩子，约定俗成的命名规则是：把默认 skill 名前缀里的 `harness-` 替换成 `harness-custom-`。

通用语义：

- **扩展而非替换**：钩子不存在时默认流程完整工作；存在时在默认流程的指定节点被额外调用，用于做增量增强。
- **发现机制**：默认 skill 在运行时检查当前会话「可用 skills 列表」中是否含同名 `harness-custom-*`，有则调用并传入约定字段。
- **执行约束**：所有 custom skill 都在 `claude -p` 非交互模式下被调用，完成动作后应立即结束响应；只做增强，不应破坏默认流程已写入的核心字段。

下面列出当前已经预留的扩展点，未来新增的 `harness-custom-*` 也会继续追加在本节中。

### `harness-custom-todo-create` — 任务创建后的扩展钩子

`harness-todo-create` 默认会在 `.harness/todos.json` 写入记录并通过 tmux 启动本地 Claude Code 会话。如果希望在创建完成后追加自定义动作 —— 例如 **同步到远端任务系统 / 推送创建通知 / 写入额外元数据 / 触发 CI 预热** 等，可以提供该钩子。

**触发时机**：`harness-todo-create` 完成「分析描述 → 写入记录 → 启动 tmux 会话 → 回写元数据」之后。

**传入参数**（创建完成后的完整字段）：

| 字段 | 说明 |
| --- | --- |
| `cwd` | 待办项所在工作目录 |
| `id` | 自动生成的待办项 ID |
| `title` | 由默认 skill 总结出的简短标题（10–20 字） |
| `description` | 用户原始描述（若来自 meego 等需求源，已被补全） |
| `status` | 此时固定为 `running` |
| `tmuxSessionId` | 已启动的 tmux 会话 ID（`harness-<id>`） |
| `remoteControlUrl` | Claude 启动时获取到的 remote-control URL |
| `claudeSessionId` | Claude Code 的 session ID |
| `claudeSessionName` | `[HARNESS_SESSION]<title>` |

**典型用法**：调用远端 API 登记任务、投递"新任务已创建"卡片到 IM、把 `remoteControlUrl` 同步到团队看板等。

**注意**：不要修改或删除已写入 `.harness/todos.json` 的核心字段，否则会破坏默认流程的契约。

### `harness-custom-todo-finish` — 任务完成后的扩展钩子

`harness-todo-finish` 默认会关闭 tmux 会话并把记录状态改为 `done` / `failed`。如果希望在完成后追加自定义动作 —— 例如 **在远端任务系统里关单 / 把团队看板卡片移到 Done 列 / 发送"任务已完成"通知 / 归档产出物** 等，可以提供该钩子。

**触发时机**：`harness-todo-finish` 完成「关闭 tmux 会话 → 更新记录状态」之后。

**传入参数**（完成后的完整字段，`status` 已是最终态）：

| 字段 | 说明 |
| --- | --- |
| `cwd` | 待办项所在工作目录 |
| `id` | 待办项 ID |
| `title` | 待办项标题 |
| `description` | 用户原始描述 |
| `status` | 最终状态，`done` 或 `failed` |
| `tmuxSessionId` | 已关闭的 tmux 会话 ID（保留作为历史） |
| `remoteControlUrl` | 远程控制链接（保留作为历史） |
| `claudeSessionId` | Claude Code 的 session ID |
| `claudeSessionName` | `[HARNESS_SESSION]<title>` |

**典型用法**：调用远端 API 关单、把卡片移到对应列、投递"任务已完成/失败"IM 通知、把产出物上传到制品库等。

**注意**：不要回滚或修改已写入 `.harness/todos.json` 的核心字段，否则会破坏默认流程的契约。

### `harness-custom-notice-user` — 通知投递的扩展钩子

`harness-notice-user` 默认把通知输出到控制台（由 tmux 通知会话承接显示）。如果希望把通知推送到 **飞书 / Slack / 钉钉 / 邮件 / 企业微信** 等自定义渠道，提供该钩子即可。

**触发时机**：`harness-notice-user` 组装好通知内容、即将走默认控制台输出之前。

**传入参数**：

| 字段 | 说明 |
| --- | --- |
| `title` | 待办项标题，来自 `todo.title` |
| `status` | 待办项状态，值域 `pending \| running \| done \| failed` |
| `summary` | 基于最后一轮对话生成的中文摘要（结论型、提问型或进行中描述） |
| `tmuxSessionId` | 关联的 tmux 会话 ID，方便用户快速 attach 回去查看 |
| `remoteControlUrl` | 远程控制链接（如启用） |

**典型用法**：用 curl / webhook SDK / 邮件网关等投递到目标渠道；如果渠道支持富文本，可用 `status` 做颜色/图标区分，用 `tmuxSessionId` + `remoteControlUrl` 生成可点击的快速跳转入口。

## Data

Todo items are stored in `.harness/todos.json` in the current working directory.
