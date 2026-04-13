# Easy Harness

Claude Code skill package for terminal-based todo management with tmux-backed Claude sessions.

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
- `/harness-todo-remove` — Remove a todo and kill its tmux session
- `/harness-session-send-user-message` — Send a message to a running Claude session
- `/harness-notice-user` — Send a notification about a todo's status

## Data

Todo items are stored in `.harness/todos.json` in the current working directory.
