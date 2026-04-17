---
name: harness-schedule-start
description: "Start the harness cron scheduler. Reads schedules from .harness/config.json and launches a background tmux session running cron jobs. Use when user wants to start scheduled tasks, enable cron jobs, or mentions 'schedule start'."
---

# Harness Schedule Start

启动定时任务调度器。读取 `.harness/config.json` 中的 `schedules` 配置，在后台 tmux 会话中启动 cron 调度进程。

## 处理流程

### 1. 确定会话名

```bash
PROJECT=$(basename "<cwd>")
SESSION="scheduler-${PROJECT}"
```

### 2. 检查是否已运行

```bash
tmux has-session -t "$SESSION" 2>/dev/null
```

- 已存在 → 告知用户：`调度器已在运行（${SESSION}）。如需重新加载配置，请先执行 /harness-schedule-stop 或使用 /harness-schedule-restart。`
- 不存在 → 继续

### 3. 校验配置

```bash
npx --yes tsx -e "
import { loadSchedulesFromConfig } from '<pluginRoot>/src/services/scheduler.ts';
const { valid, warnings } = loadSchedulesFromConfig(process.argv[1]);
console.log(JSON.stringify({ valid, warnings }));
" "<cwd>"
```

- `valid` 为空 → 告知用户：`未找到有效的 schedules 配置。请检查 .harness/config.json。`
- 有 warnings → 逐条展示

### 4. 启动 tmux 会话

```bash
tmux new-session -d -s "$SESSION" -c "<cwd>" \
  "npx --yes tsx '<pluginRoot>/src/scripts/scheduler.ts' --cwd '<cwd>'"
```

### 5. 回显

向用户输出确认：

> 调度器已启动（`${SESSION}`），加载了 N 条 schedule：
>
> | Name | Cron | Type | Target |
> |------|------|------|--------|
> | daily-review | 0 9 * * * | skill | harness-todo-list |
>
> - `tmux attach -t ${SESSION}` 查看日志
> - `/harness-schedule-stop` 停止调度器
