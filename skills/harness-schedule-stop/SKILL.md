---
name: harness-schedule-stop
description: "Stop the harness cron scheduler. Kills the scheduler tmux session. Use when user wants to stop scheduled tasks, disable cron jobs, or mentions 'schedule stop'."
---

# Harness Schedule Stop

停止定时任务调度器。

## 处理流程

### 1. 确定会话名

```bash
PROJECT=$(basename "<cwd>")
SESSION="scheduler-${PROJECT}"
```

### 2. 检查是否在运行

```bash
tmux has-session -t "$SESSION" 2>/dev/null
```

- 不存在 → 告知用户：`调度器未在运行。`
- 存在 → 继续

### 3. 停止

```bash
tmux kill-session -t "$SESSION"
```

### 4. 回显

> 调度器已停止（`${SESSION}`）。
