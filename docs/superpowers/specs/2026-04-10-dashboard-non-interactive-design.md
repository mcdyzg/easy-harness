# Dashboard Non-Interactive Redesign

## Background

Ink (React for CLI) applications cannot run inside Claude Code's Bash tool because it lacks an interactive terminal (no stdin control, no cursor positioning). The `/harness-dashboard` skill needs to be redesigned as a non-interactive, pure-instruction skill.

## Design

### Approach

Replace the Ink-based interactive dashboard with a pure SKILL.md instruction that tells Claude to read `todos.json` directly and render a Markdown table. No script execution needed.

### Changes

| Action | Target | Detail |
|--------|--------|--------|
| Rewrite | `skills/harness-dashboard/SKILL.md` | Pure instruction skill: read JSON, render Markdown table |
| Keep | `src/ui/` | Retained as backup, no longer invoked |
| Remove | `package.json` dependencies | `ink`, `ink-text-input`, `react`, `@types/react` |
| No change | `store.ts`, `types.ts`, `services/` | Still used by other skills |
| No change | Other 3 skills | `harness-todo-create`, `harness-session-send-user-message`, `harness-notice-user` |

### SKILL.md Logic

1. Read `<cwd>/.harness/todos.json`
2. If file missing or empty array: output "暂无待办项，使用 `/harness-todo-create` 创建"
3. If data exists: render Markdown table with columns:

| Column | Source field | Note |
|--------|-------------|------|
| Status | `status` | Emoji: ⚪ pending, 🔵 running, 🟢 done, 🔴 failed |
| Title | `title` | - |
| ID | `id` | - |
| Tmux Session | `tmuxSessionId` | - |
| Remote URL | `remoteControlUrl` | - |

Example output:

```markdown
| Status | Title | ID | Tmux Session | Remote URL |
|--------|-------|----|--------------|------------|
| 🔵 running | 实现登录功能 | abc123 | harness-abc123 | https://... |
| ⚪ pending | 添加单元测试 | def456 | harness-def456 | https://... |
```

### Architecture After Change

```
/harness-todo-list skill
    └── SKILL.md (instructs Claude to read JSON + render Markdown)

/harness-todo-create skill
    └── SKILL.md (uses store.ts, tmux.ts to create todo + session)

/harness-session-send-user-message skill
    └── SKILL.md (uses tmux.ts to send message)

/harness-notice-user skill
    └── SKILL.md (uses notice.ts to format + send)

src/ui/ (backup, not invoked)
```

### What Does NOT Change

- `TodoStore` (store.ts) — still the single source of truth for todos
- `TodoItem` type (types.ts) — no schema change
- Services (tmux.ts, session-log.ts, notice.ts) — used by other skills
- The other 3 skills — independent, unaffected
