# Harness Dashboard

Claude Code skill package for terminal-based todo management with tmux-backed Claude sessions.

## Installation

Install this plugin in Claude Code:

```bash
claude plugins install <path-to-harness-dashboard>
```

## Hook Setup

This plugin registers a `Stop` hook automatically via `hooks/hooks.json`. No manual `settings.json` configuration is required.

The hook fires when Claude finishes a turn inside a tmux session whose name starts with `harness-`. It dispatches a separate ephemeral tmux session that runs Claude with the `harness-notice-user` skill to generate and deliver a notification.

## Skills

- `/harness-todo-list` — Open the terminal todo management UI
- `/harness-todo-create` — Create a new todo from a description
- `/harness-session-send-user-message` — Send a message to a running Claude session
- `/harness-notice-user` — Send a notification about a todo's status

## Data

Todo items are stored in `.harness/todos.json` in the current working directory.
