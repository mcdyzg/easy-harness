---
name: harness-todo-remove
description: "Remove a harness todo item by ID. Kills the associated tmux session (which also terminates the embedded Claude Code process) and deletes the record from .harness/todos.json. Use when user wants to delete/remove/clean up a todo in the harness system."
---

# Harness Todo Remove

删除指定待办项，同时关闭其关联的 tmux 会话（会一并结束其中运行的 Claude Code 进程）。

## 输入

- 待办项标识（接受以下形式）：
  - **纯数字** → `harness-todo-list` 表格里的序号（1-based）
  - **非纯数字** → 先按 ID 精确匹配；未命中再按 title 大小写不敏感 substring 模糊匹配
  - **清空语义**（"全部" / "所有" / "all" / "清空" / "clear" / "删光" 等）→ 走「全量删除分支」，批量清除所有待办项

## 处理流程

> 先判断输入是否属于「清空语义」；若是，走分支 A；否则走分支 B。

### 分支 A — 全量删除

#### A1. 列出与二次确认

读取全部待办项，输出 `harness-todo-list` 风格的表格，并在下方给出**明确警告**，要求用户再确认一次（例如回复 `y` / `yes` / `确认`）：

```
⚠️ 你确定要删除全部 <N> 条待办项吗？

| # | Status | Title | ID | Tmux Session |
|---|--------|-------|----|--------------|
| 1 | 🔵 running | ... | ... | ... |
| 2 | ⚪ pending | ... | ... | ... |
...

此操作不可撤销：记录会被删除，对应 tmux 会话（及其中的 Claude Code 进程）会被关闭。
请回复 "yes" / "y" / "确认" 继续，其他任何回复视为取消。
```

若列表为空，直接告知用户「当前没有待办项，无需删除」并结束。

#### A2. 用户未明确确认 → 中止

任何非确认性回复都视为取消，向用户输出 `已取消，未删除任何待办项` 并结束。

#### A3. 批量清理

拉取当前列表后**逐条处理**；每条的 tmux kill 与记录 delete 都用 `|| true` 兜底，保证单条失败不会阻断全量操作：

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
const store = new TodoStore(process.argv[1]);
console.log(JSON.stringify(store.list().map(t => ({ id: t.id, title: t.title, tmuxSessionId: t.tmuxSessionId }))));
" "<cwd>"
```

对每一项：

```bash
if [ -n "<tmuxSessionId>" ]; then
  tmux kill-session -t "<tmuxSessionId>" 2>/dev/null || true
fi
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
const store = new TodoStore(process.argv[1]);
store.delete(process.argv[2]);
" "<cwd>" "<id>" || true
```

#### A4. 汇总反馈

```
已清空全部待办项：共删除 <N> 条，其中 <M> 条关联 tmux 会话已关闭。
```

---

### 分支 B — 单项删除

#### B1. 首次查找

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
import { lookupTodo, LookupError } from '<plugin-dir>/src/utils/lookup.ts';
const store = new TodoStore(process.argv[1]);
const items = store.list();
try {
  const r = lookupTodo(process.argv[2], items);
  console.log(JSON.stringify(r));
} catch (e) {
  if (e instanceof LookupError) {
    console.error(JSON.stringify({ code: e.code, message: e.message }));
    process.exit(1);
  }
  throw e;
}
" "<cwd>" "<标识>"
```

stdout 是 JSON：

- `{"mode":"match","todo":{...}}` — 直接命中，跳到第 B3 步
- `{"mode":"confirm","candidates":[{...}]}` — 模糊命中，进入第 B2 步

stderr + 非零退出 → 把 `message` 字段直接展示给用户。

#### B2. 候选确认（仅当 mode 为 confirm）

向用户输出候选表（候选列表里的 `#` 是该列表内的序号，与全局列表无关）：

```
未按 ID 精确匹配到待办项，以下是按 title 模糊匹配到的候选项：

| # | Title | ID | Status |
|---|-------|----|--------|
| 1 | 实现登录功能 | abc123def456 | 🔵 running |
| 2 | 登录页样式调整 | xyz789ghi012 | ⚪ pending |

请回复序号或完整 ID 以确认要删除的待办项。
```

收到用户回复后，用候选列表再次解析：

```bash
npx tsx -e "
import { resolveCandidate, LookupError } from '<plugin-dir>/src/utils/lookup.ts';
const candidates = JSON.parse(process.argv[1]);
try {
  const todo = resolveCandidate(process.argv[2], candidates);
  console.log(JSON.stringify(todo));
} catch (e) {
  if (e instanceof LookupError) {
    console.error(JSON.stringify({ code: e.code, message: e.message }));
    process.exit(1);
  }
  throw e;
}
" '<candidates JSON>' "<用户回复>"
```

若再次失败，按 stderr 文案告知用户后终止；不再次进入模糊匹配，避免发散。

#### B3. 运行中保护

拿到 `todo` 后，若 `todo.status === 'running'`，先提示：

> 该待办项仍在运行（status: running），删除会直接关闭其 tmux 会话和 Claude Code 进程，是否继续？

得到明确确认后再继续，否则终止。

#### B4. 关闭 tmux 会话

`tmuxSessionId` 非空时才执行；用 `|| true` 兜底，避免会话已不存在时报错。

```bash
if [ -n "<tmuxSessionId>" ]; then
  tmux kill-session -t "<tmuxSessionId>" 2>/dev/null || true
fi
```

#### B5. 删除记录

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
const store = new TodoStore(process.argv[1]);
store.delete(process.argv[2]);
" "<cwd>" "<todo-id>"
```

#### B6. 反馈

向用户输出一行确认，例如：

> 已删除待办项 `<title>`（id: `<id>`），tmux 会话 `<tmuxSessionId>` 已关闭。

若步骤 B4 跳过（`tmuxSessionId` 为空），则省略最后一段。

---

## 注意事项

- 删除是不可逆操作。若用户只说「删掉那个登录任务」这类模糊描述，优先走 B1 的三路查找；仍无法定位时宁愿请用户重新指认，也不要猜测。
- 与 `/harness-todo-finish` 的区别：`finish` 只改状态 + 关会话、**保留记录**方便回溯；`remove` 会**连记录一起删除**。若用户意图模糊，先确认再动手。
- 分支 A 的批量删除必须走二次确认，**禁止**在用户只说一次"清空 / 全部删"时直接执行。

## 错误文案对照

| 场景 | 文案来源 |
|------|----------|
| 序号越界 / 候选序号越界 | `LookupError` `OUT_OF_RANGE` 的 message |
| 三路查找均未命中 | `LookupError` `NOT_FOUND` 的 message |
| 确认阶段无法定位 | `LookupError` `NOT_FOUND` 的 message |
| 清空确认被拒绝 | `已取消，未删除任何待办项` |
| 列表为空（分支 A） | `当前没有待办项，无需删除` |
| tmux 会话不存在 | tmux stderr（已被 `\|\| true` 静默兜底，可忽略） |
