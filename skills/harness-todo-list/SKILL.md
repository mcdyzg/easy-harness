---
name: harness-todo-list
description: "List harness todo items. Use when the user wants to view the todo list / dashboard in the harness system. Triggers on: /harness-todo-list, 'open dashboard', 'show todos', 'harness list'."
---

# Harness Todo List

展示当前工作目录下的待办项列表。

## 使用方式

1. 读取 `<cwd>/.harness/todos.json` 文件
2. 如果文件不存在或内容为空数组，输出：

> 暂无待办项，使用 `/harness-todo-create` 创建。

3. 如果有数据，渲染为 Markdown 表格，列定义如下：

| 列名 | 字段 | 说明 |
|------|------|------|
| # | 数组下标 + 1 | 1-based 序号，按 `store.list()` 返回顺序 |
| Status | `status` | 用 emoji 标记：⚪ pending, 🔵 running, 🟢 done, 🔴 failed |
| Title | `title` | 待办项标题 |
| ID | `id` | 待办项 ID |
| Tmux Session | `tmuxSessionId` | tmux 会话标识 |
| Remote URL | `remoteControlUrl` | 远程控制链接 |
| Extras | `metadata` | 外链 bag（按规则渲染，详见下文） |

> 序号（#）是展示时的临时索引，删除待办项后会变动；需要跨会话稳定引用时请使用 ID。

## Extras 单元格渲染规则

- `metadata` 为 `undefined` 或空对象：单元格输出 `—`（em dash）
- 否则遍历键值对（**按 key 字母序**）：
  - 值以 `http://` 或 `https://` 开头：渲染为 `[key](value)`
  - 否则：渲染为 `key: value`
- 多个条目用 `<br>` 分隔

## 输出示例

```markdown
| # | Status | Title | ID | Tmux Session | Remote URL | Extras |
|---|--------|-------|----|--------------|------------|--------|
| 1 | 🔵 running | 实现登录功能 | abc123 | harness-abc123 | https://... | [code](https://github.com/x/y/pull/1)<br>[meego](https://meego.feishu.cn/1) |
| 2 | ⚪ pending | 添加单元测试 | def456 | harness-def456 | https://... | — |
```

## 相关 Skill

- `/harness-todo-create` — 创建新待办项并启动 Claude 会话
- `/harness-todo-remove` — 删除待办项并关闭其 tmux 会话
- `/harness-session-send-user-message` — 向运行中的会话发送消息（支持序号 / ID / title 模糊）
- `/harness-notice-user` — 发送通知消息
