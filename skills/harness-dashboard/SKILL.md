---
name: harness-dashboard
description: "Open the Harness Dashboard terminal UI to manage todo items. Use when the user wants to view, create, edit, delete, or execute todo items in the harness system. Triggers on: /harness-dashboard, 'open dashboard', 'show todos', 'harness list'."
---

# Harness Dashboard

打开基于 Ink 的终端待办项管理界面。

## 使用方式

运行 dashboard 脚本：

```bash
npx tsx <plugin-dir>/src/ui/run.tsx <cwd>
```

其中 `<cwd>` 为当前工作目录（.harness/todos.json 所在目录的父目录）。

## Dashboard 输出处理

Dashboard 通过 stdout 输出 JSON 操作指令，格式如下：

- 新建：`{"action": "create", "description": "..."}`
  - 收到此指令后，调用 `/harness-todo-create` skill，传入 description
- 编辑：`{"action": "edit", "id": "...", "description": "..."}`
  - 收到此指令后，更新 .harness/todos.json 中对应待办项的 description 字段
  - 根据新 description 重新生成标题并更新
- 删除：在 dashboard 内直接完成，无需额外处理
- 执行：`{"action": "execute", "id": "...", "text": "..."}`
  - 收到此指令后，调用 `/harness-session-send-user-message` skill，传入 id 和 text
