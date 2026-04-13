---
name: harness-todo-remove
description: "Remove a harness todo item by ID. Kills the associated tmux session (which also terminates the embedded Claude Code process) and deletes the record from .harness/todos.json. Use when user wants to delete/remove/clean up a todo in the harness system."
---

# Harness Todo Remove

删除指定待办项，同时关闭其关联的 tmux 会话（会一并结束其中运行的 Claude Code 进程）。

## 输入

- 待办项 ID

## 处理流程

### 1. 查找待办项

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.js';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (!todo) { console.error('待办项不存在'); process.exit(1); }
console.log(JSON.stringify({ id: todo.id, title: todo.title, tmuxSessionId: todo.tmuxSessionId, status: todo.status }));
" "<cwd>" "<todo-id>"
```

若找不到，直接告知用户"待办项 `<id>` 不存在"并结束。

### 2. 关闭 tmux 会话

`tmuxSessionId` 非空时才执行；用 `|| true` 兜底，避免会话已不存在时报错。

```bash
if [ -n "<tmuxSessionId>" ]; then
  tmux kill-session -t "<tmuxSessionId>" 2>/dev/null || true
fi
```

### 3. 删除记录

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.js';
const store = new TodoStore(process.argv[1]);
store.delete(process.argv[2]);
" "<cwd>" "<todo-id>"
```

### 4. 反馈

向用户输出一行确认，例如：

> 已删除待办项 `<title>`（id: `<id>`），tmux 会话 `<tmuxSessionId>` 已关闭。

若步骤 2 跳过（`tmuxSessionId` 为空），则省略最后一段。

## 注意事项

- 删除是不可逆操作，若用户未明确指定 ID（例如只说"删掉那个登录任务"），应先通过 `/harness-todo-list` 列表确认，再请用户给出确切 ID。
- 不要在 `status === 'running'` 时静默删除：先提示用户该会话仍在运行，确认后再继续。
