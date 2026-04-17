---
name: harness-schedule-restart
description: "Restart the harness cron scheduler. Stops and re-starts the scheduler with fresh config. Use when user wants to restart scheduled tasks, reload schedule config, or mentions 'schedule restart'."
---

# Harness Schedule Restart

重启定时任务调度器。停止当前调度器（如果在运行），然后重新加载配置并启动。

## 处理流程

### 1. 确定会话名

```bash
PROJECT=$(basename "<cwd>")
SESSION="scheduler-${PROJECT}"
```

### 2. 停止（静默）

```bash
tmux kill-session -t "$SESSION" 2>/dev/null || true
```

无论是否存在，都不报错。

### 3. 执行 start 逻辑

按照 `harness-schedule-start` 的步骤 3-5 执行：校验配置 → 启动 tmux 会话 → 回显。

### 4. 回显

> 调度器已重启（`${SESSION}`），加载了 N 条 schedule。
> - `tmux attach -t ${SESSION}` 查看日志
