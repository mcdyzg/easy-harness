# Harness Dashboard

Claude Code skill package for terminal-based todo management with tmux-backed Claude sessions.

## Installation

Install this plugin in Claude Code:

```bash
claude plugins install <path-to-harness-dashboard>
```

## Hook Setup

Add the following hook to your Claude Code `settings.json` to enable auto-notification on session end:

```json
{
  "hooks": {
    "PostToolUse": [],
    "SessionEnd": [
      {
        "name": "harness-session-end",
        "command": "<plugin-dir>/hook/on-session-end.sh $CWD"
      }
    ]
  }
}
```

## Skills

- `/harness-dashboard` — Open the terminal todo management UI
- `/harness-todo-create` — Create a new todo from a description
- `/harness-session-send-user-message` — Send a message to a running Claude session
- `/harness-notice-send-message` — Send a notification about a todo's status

## Data

Todo items are stored in `.harness/todos.json` in the current working directory.
