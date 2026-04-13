# Harness Todo 灵活查找设计

## 背景与动机

`harness-session-send-user-message` 目前只接受 nanoid 生成的 12 位 ID 作为待办项标识。用户在 dashboard 上看到表格后，还必须把 ID 复制出来才能发送消息——对于交互场景过于繁琐。

目标：让用户能用表格里的序号（最常用）、完整 ID（精确引用）、或 title 的片段（模糊引用）三种方式定位待办项。

## 范围

本次变更只涉及两个 skill：

1. `skills/harness-todo-list/SKILL.md` —— 展示层增加序号列
2. `skills/harness-session-send-user-message/SKILL.md` —— 查找逻辑支持三种标识形式

明确**不做**：

- 不改 `harness-todo-remove` 的查找逻辑（YAGNI；若后续需要同样的能力，再单独处理）
- 不改底层 `src/store.ts` API（查找逻辑在 skill 的 tsx 脚本里完成即可）
- 不对 `todos.json` 持久化结构做任何改动（序号是纯展示，不落盘）

## 设计 Part 1：`harness-todo-list` 增加序号列

### 表格结构

| 列名 | 来源 | 说明 |
|------|------|------|
| **#** | 数组下标 + 1 | 1-based 序号，按 `store.list()` 返回顺序 |
| Status | `status` | emoji：⚪ pending / 🔵 running / 🟢 done / 🔴 failed |
| Title | `title` | 标题 |
| ID | `id` | nanoid(12) |
| Tmux Session | `tmuxSessionId` | tmux 会话标识 |
| Remote URL | `remoteControlUrl` | 远程控制链接 |

### 序号语义

- 序号完全等同于 `store.list()` 返回数组的下标 + 1
- 序号是**展示时的临时索引**，不持久化、不跨会话稳定
- 删除任一待办项后，后续项的序号会前移

SKILL.md 需在"输出示例"附近加一段提示：

> 序号（#）是展示时的临时索引，在删除待办项后会变动；需要跨会话稳定引用时请使用 ID。

### 空列表行为

保持现状：输出"暂无待办项，使用 `/harness-todo-create` 创建。"

## 设计 Part 2：`harness-session-send-user-message` 多策略查找

### 输入语义

原先固定为"待办项 ID"，现改为"待办项标识"，允许：

- **纯数字** → 序号（1-based）
- **非纯数字** → 先按 ID 精确匹配，未命中再按 title 做大小写不敏感的 substring 模糊匹配

ID 是 `nanoid(12)`，字符集为 `A-Za-z0-9_-`，**不可能只含数字**，所以"纯数字 = 序号"的消歧是安全的。

> 已知代价：若用户想用纯数字字符串（如 "2024"）做 title 模糊匹配会被强制当作序号处理。此时用户可改用包含字母的 title 片段，或直接使用完整 ID。

### 查找算法

```
lookup(input, items):
  trimmed = input.trim()

  # 1. 序号路径
  if /^\d+$/.test(trimmed):
    idx = parseInt(trimmed, 10) - 1
    if idx < 0 or idx >= items.length:
      throw "序号越界：共 {items.length} 条待办项"
    return { match: items[idx], needsConfirm: false }

  # 2. ID 精确匹配
  byId = items.find(it => it.id === trimmed)
  if byId:
    return { match: byId, needsConfirm: false }

  # 3. 模糊匹配（大小写不敏感 substring，仅匹配 title）
  needle = trimmed.toLowerCase()
  candidates = items.filter(it => it.title.toLowerCase().includes(needle))
  if candidates.length === 0:
    throw "未找到匹配的待办项（按 ID 精确匹配和 title 模糊匹配均无结果）"

  return { candidates, needsConfirm: true }
```

**模糊匹配仅匹配 `title`**，不匹配 `description`。理由：`description` 可能很长且包含噪声（meego 链接、上下文），模糊命中率低且不直观。

### 二次确认流程

当 `needsConfirm === true` 时，列出**所有**候选项（不做数量截断），让用户明确选择：

```
未按 ID 精确匹配到待办项，以下是按 title 模糊匹配到的候选项：

| # | Title | ID | Status |
|---|-------|----|--------|
| 1 | 实现登录功能 | abc123def456 | 🔵 running |
| 2 | 登录页样式调整 | xyz789ghi012 | ⚪ pending |

请回复序号或完整 ID 以确认要发送的待办项。
```

注意：这里的 `#` 是**候选列表里的序号**，而非全局 todo 列表的序号。所以该列表同时要带上 ID，用户回复 ID 是兜底方式。

用户下一次回复后：

- 如果回复纯数字 `n`，在候选列表中定位第 `n` 个（1-based）
- 如果回复非纯数字，在候选列表中按 ID 精确匹配

若用户回复仍然无法定位，再次报错并提示重试（不再递归模糊匹配，避免发散）。

### 后续流程保持不变

找到 `match` 后：

1. 校验 `match.status === 'running'`；否则提示"该会话未在运行"
2. 校验 `match.tmuxSessionId` 非空；否则提示"会话已关闭"
3. `tmux send-keys -t "<tmuxSessionId>" '<文本>' Enter`

## 实现位置

两个 skill 都是 Markdown 工作流描述，不涉及 TS 源码改动。查找逻辑通过内联的 `npx tsx -e "..."` 脚本实现，脚本读取 `TodoStore.list()`，在内存里完成序号/ID/title 三路查找。

返回给 skill 的结果结构：

```json
{ "mode": "match", "todo": { ... } }
```

或

```json
{ "mode": "confirm", "candidates": [ { ... }, ... ] }
```

或以非零退出码 + stderr 文案报错。

## 错误文案

| 场景 | 文案 |
|------|------|
| 序号越界 | `序号越界：共 N 条待办项，有效范围 1–N` |
| ID 精确+title 模糊均未命中 | `未找到匹配的待办项：请检查序号、ID 或 title 片段是否正确` |
| 确认阶段再次无法定位 | `仍未能定位，请重新执行 /harness-session-send-user-message` |
| 找到后状态不是 running | `该会话未在运行（当前状态：<status>）` |
| tmux 会话不存在 | `tmux 会话 <tmuxSessionId> 已关闭` |

## 测试计划

由于这是 skill（Markdown 工作流）而非代码，无单元测试。手工验收路径：

1. 列表展示：执行 `/harness-todo-list`，确认表格首列出现 `#`，数值 1..N
2. 序号发送：`/harness-session-send-user-message 1 "<msg>"` → 命中第 1 条
3. ID 发送：用完整 nanoid → 精确命中
4. 模糊单命中：输入 title 中间片段，候选表出现 1 行，用户选 1 后发送成功
5. 模糊多命中：输入多条 title 共享的关键词，候选表出现多行
6. 模糊零命中：输入无意义字符串，报错退出
7. 序号越界：输入大于 N 的数字 / 0 / 负数，报错退出

## 非目标

- 不引入 fuzzy matching 算法（Levenshtein、子序列等），substring 足够
- 不缓存序号 → id 映射，每次查找重新读 `todos.json`
- 不在 `harness-todo-remove` 上复用同一查找逻辑（本次仅消息发送场景有此诉求）
