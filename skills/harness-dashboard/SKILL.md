---
name: harness-dashboard
description: "Open the Harness Dashboard to view todo items. Use when the user wants to view todo list status in the harness system. Triggers on: /harness-dashboard, 'open dashboard', 'show todos', 'harness list'."
---

# Harness Dashboard

展示当前工作目录下的待办项列表。

## 使用方式

1. 读取 `<cwd>/.harness/todos.json` 文件
2. 如果文件不存在或内容为空数组，输出：

> 暂无待办项，使用 `/harness-todo-create` 创建。

3. 如果有数据，渲染为 Markdown 表格，列定义如下：

| 列名 | 字段 | 说明 |
|------|------|------|
| Status | `status` | 用 emoji 标记：⚪ pending, 🔵 running, 🟢 done, 🔴 failed |
| Title | `title` | 待办项标题 |
| ID | `id` | 待办项 ID |
| Tmux Session | `tmuxSessionId` | tmux 会话标识 |
| Remote URL | `remoteControlUrl` | 远程控制链接 |

## 输出示例

```markdown
| Status | Title | ID | Tmux Session | Remote URL |
|--------|-------|----|--------------|------------|
| 🔵 running | 实现登录功能 | abc123 | harness-abc123 | https://... |
| ⚪ pending | 添加单元测试 | def456 | harness-def456 | https://... |
```

## 相关 Skill

- `/harness-todo-create` — 创建新待办项并启动 Claude 会话
- `/harness-session-send-user-message` — 向运行中的会话发送消息
- `/harness-notice-send-message` — 发送通知消息
