# Scheduled Tasks (Cron-based Skill/Command Execution)

## Overview

为 easy-harness 增加周期性定时任务能力。用户在项目级 `.harness/config.json` 中配置 cron schedule，通过 skill 手动启停调度器，调度器在后台 tmux 会话中以单进程管理所有 cron job。

## Config Format

在 `.harness/config.json` 中新增 `schedules` 字段，与 `hooks` 平级：

```json
{
  "hooks": { ... },
  "schedules": [
    {
      "name": "daily-review",
      "cron": "0 9 * * *",
      "type": "skill",
      "skill": "harness-todo-list"
    },
    {
      "name": "weekly-cleanup",
      "cron": "0 0 * * 0",
      "type": "command",
      "command": "rm -rf /tmp/harness-cache-*"
    }
  ]
}
```

### Field Definitions

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | 唯一标识，用于日志和管理展示 |
| `cron` | yes | 标准 5 位 cron 表达式（croner 语法） |
| `type` | yes | `"skill"` 或 `"command"` |
| `skill` | when type=skill | 要调用的 Claude Code skill 名称 |
| `command` | when type=command | 要执行的 shell 命令 |

### Validation Rules

- `name` 在数组内必须唯一
- `cron` 必须是合法 cron 表达式（croner 解析失败则跳过该条并 warn）
- `type=skill` 时 `skill` 字段必填
- `type=command` 时 `command` 字段必填

## Scheduler Process

### Architecture

单个 Node 进程作为调度器，启动时：

1. 读取 `.harness/config.json` 中的 `schedules` 数组
2. 校验每条 schedule 配置
3. 对每条合法 schedule 创建一个 `Cron` 实例
4. 注册 SIGINT/SIGTERM 优雅退出，stop 所有 Cron 实例

### Execution Model

每次 cron 触发时同步执行：

- `type=command` → `execSync(command, { cwd })`
- `type=skill` → `execSync('claude -p "调用 <skill> skill"', { cwd })`

错误处理：catch 后 log error，不影响其他 schedule 继续运行。

### tmux Session

- 会话名：`scheduler-<project>`（`<project>` 取 cwd 目录名）
- 单例：start 前检测是否已有同名会话，已存在则提示先 stop
- 避免 `harness-*` 前缀，防止与 Stop hook 作用域冲突

### Logging

```
[2026-04-16T09:00:00.000Z] info  scheduler started: 2 schedules loaded
[2026-04-16T09:00:00.000Z] info  [daily-review] triggered (skill: harness-todo-list)
[2026-04-16T09:00:01.500Z] info  [daily-review] completed (1.5s)
[2026-04-16T09:00:01.500Z] error [weekly-cleanup] failed: command exited with code 1
```

日志直接输出到 tmux 会话 stdout，用户可 `tmux attach -t scheduler-<project>` 查看。

### Config Change Handling

不自动感知 config 变更。用户修改 config.json 后需手动执行 restart 来生效。

## Skills

### `/harness-schedule-start`

1. 检查 `scheduler-<project>` tmux 会话是否已存在，已存在则提示先 stop
2. 读取 `.harness/config.json`，校验 `schedules` 配置
3. 启动 tmux 会话，内跑 `npx tsx src/scripts/scheduler.ts --cwd <cwd>`
4. 输出启动结果：加载了多少条 schedule，各自的 cron 和名称

### `/harness-schedule-stop`

1. 检查 `scheduler-<project>` tmux 会话是否存在，不存在则提示未启动
2. `tmux kill-session -t scheduler-<project>`
3. 输出已停止

### `/harness-schedule-restart`

1. 执行 stop 逻辑（会话不存在也不报错）
2. 执行 start 逻辑
3. 输出重启结果

## File Changes

### New Files

| File | Description |
|------|-------------|
| `src/services/scheduler.ts` | 核心调度逻辑：读取 config、校验、创建 Cron 实例、执行 action |
| `src/scripts/scheduler.ts` | CLI 入口：解析 `--cwd` 参数，调用 `runScheduler()` |
| `skills/harness-schedule-start/SKILL.md` | start skill 定义 |
| `skills/harness-schedule-stop/SKILL.md` | stop skill 定义 |
| `skills/harness-schedule-restart/SKILL.md` | restart skill 定义 |
| `tests/services/scheduler.test.ts` | 调度逻辑单元测试 |

### Modified Files

| File | Change |
|------|--------|
| `src/types.ts` | 新增 `ScheduleItem` 类型定义 |
| `.claude-plugin/plugin.json` | 注册 3 个新 skill |

### Unaffected

现有 hooks 系统、polling 系统、todo 系统完全不受影响。`config.json` 中 `hooks` 和 `schedules` 是平级独立字段。

## Type Definitions

```typescript
interface ScheduleItemBase {
  name: string;
  cron: string;
}

interface SkillSchedule extends ScheduleItemBase {
  type: "skill";
  skill: string;
}

interface CommandSchedule extends ScheduleItemBase {
  type: "command";
  command: string;
}

type ScheduleItem = SkillSchedule | CommandSchedule;
```
