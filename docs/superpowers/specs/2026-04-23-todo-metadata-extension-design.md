# TodoItem 开放式 metadata 扩展

**日期**：2026-04-23
**作者**：loujiahao
**状态**：Design

## 背景

`TodoItem`（`src/types.ts:3-13`）现在是扁平 9 字段结构，`.harness/todos.json` 直接 `JSON.stringify` 落盘，没有 schema 版本。

用户创建待办项时经常伴随外部链接（例如 meego 需求、PR、Figma）。目前 `harness-todo-create` SKILL 对 meego 的处理是把需求详情文本**拼进 `description` 字符串**，没有结构化存储——下游 skill 想单独拿到链接无法做到，飞书通知卡片等自定义渠道只能二次解析描述文本。

## 目标

给 `TodoItem` 加一个开放式 metadata bag，支持在创建时一次性写入任意外链，并由核心 skill（list、notice）默认渲染。

**非目标**：
- 不做 metadata 的运行中增改 skill
- 不把 metadata 作为 Agent 上下文（首条消息、恢复命令不读它）
- 不做 metadata 维度的搜索/筛选

## 约束

1. **开放式**：字段由用户/skill 随手塞，核心代码不维护固定字段列表。
2. **创建时一次性写入**：`harness-todo-create` skill 解析用户描述里的 URL，抽到 metadata；之后不再变动。
3. **默认在 list 和 notice 中渲染**：`harness-todo-list` 表格加 Extras 列；`harness-notice-user` 的 `NoticeMessage` 透传 metadata，默认控制台 formatter 追加"关联:"块。
4. **向后兼容**：旧 `.harness/todos.json` 不迁移，旧记录反序列化出来 `metadata` 为 `undefined`。

## 设计

### 1. Schema 与持久化

`src/types.ts`：

```ts
export interface TodoItem {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  tmuxSessionId: string;
  remoteControlUrl: string;
  claudeSessionId: string;
  claudeSessionName: string;
  firstMessageSent: boolean;
  metadata?: Record<string, string>;   // 新增
}
```

**不变的边界**：
- `buildFirstMessage`（`src/services/message.ts`）、`recovery.ts::buildFreshSpawnCommand`：不把 metadata 拼进 Agent 上下文。Agent 看到的仍然是 `description`。
- `lookup.ts`：不把 metadata 纳入搜索（按 id / tmuxSessionId / title 不变）。

**空对象归一化**：`TodoStore.add` / `update` 内部，若入参 `metadata` 是空对象（`Object.keys(metadata).length === 0`），则不写入该字段，落盘 JSON 中不出现 `"metadata": {}`。读回即 `undefined`，下游判空只有一种形态。

### 2. `harness-todo-create` — URL 解析与写入

SKILL.md 增加"识别外链"段，给 Agent 以下规则：

- 扫描描述中的 `http(s)://…` URL
- 按 host 映射到 key：
  - `*.meego.feishu.cn` / `meego.*` → `meego`
  - `*.atlassian.net` / `jira.*` → `jira`
  - `github.com` / `*.bytedance.net` → `code`
  - `figma.com` → `figma`
- 同 key 多次出现：取第一次
- 认不出的 host：跳过，不乱塞

现有的 `store.add({...})` 调用多加一个位置参数（JSON 字符串）：

```bash
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
const store = new TodoStore(process.argv[1]);
store.add({
  id, title: process.argv[2], description: process.argv[3],
  status: 'pending', tmuxSessionId: '', remoteControlUrl: '',
  claudeSessionId: '', claudeSessionName: '', firstMessageSent: false,
  metadata: JSON.parse(process.argv[4] || '{}'),
});
..." "<cwd>" "<title>" "<description>" '{"meego":"https://..."}'
```

没识别到任何外链时传 `{}`——由 store 的空对象归一化丢弃。

### 3. `harness-todo-list` — Extras 列

SKILL.md 表格增加 `Extras` 列，放末尾。单元格渲染规则：

- `metadata` 为 `undefined` 或空：输出 `—`
- 遍历键值对（按 key 字母序，保证稳定）：
  - 值以 `http://` 或 `https://` 开头：`[key](value)`
  - 否则：`key: value`
- 多个条目用 `<br>` 分隔

示例：

```markdown
| # | Status | Title | ID | Tmux Session | Remote URL | Extras |
|---|--------|-------|----|--------------|------------|--------|
| 1 | 🔵 running | 实现登录 | abc123 | harness-abc123 | https://... | [code](https://github...)<br>[meego](https://meego...) |
| 2 | ⚪ pending | 写测试 | def456 | harness-def456 | https://... | — |
```

### 4. `harness-notice-user` / `NoticeMessage` 透传

`src/types.ts`：

```ts
export interface NoticeMessage {
  title: string;
  status: string;
  summary: string;
  tmuxSessionId: string;
  remoteControlUrl: string;
  metadata?: Record<string, string>;   // 新增
}
```

`harness-notice-user` SKILL 的"组装 NoticeMessage"步骤，字段映射加一条：

- `metadata ← todo.metadata`（可能 undefined，保持 undefined 透传）

`src/services/notice.ts::formatNoticeMessage`：metadata 存在且非空时，末尾追加：

```
📋 <title>
状态: <status>
摘要: <summary>
Tmux Session: <tmuxSessionId>
Remote URL: <remoteControlUrl>
关联:
  <key>: <value>
  ...
```

排序同 list（key 字母序），控制台渠道不做 linkify（纯文本）。metadata 不存在或空：完全不输出"关联:"块。

**自定义 hook 渠道**（`notice-user` event）：hook 拿到的 `NoticeMessage` JSON 天然带 `metadata`，飞书卡片、邮件模板等可以直接消费，core 不需要改。这是本次改动最大的受益点。

**不改**：`scripts/on-stop.sh` 及 4a/4b 分流逻辑不动。

### 5. 测试

**新增**：

- `tests/store.test.ts`：
  - round-trip：`add` 带 `metadata` → `list()` 字段相等
  - 空对象归一化：`add` 传 `metadata: {}` → 落盘不含 `metadata` 字段 → 读回 `undefined`
  - `update` 替换语义：`update(id, { metadata: { meego: "..." } })` 对已有 metadata 的 todo 是整体替换（`...spread` 语义），不 deep-merge
- `tests/services/notice.test.ts`（新建）：
  - 无 metadata：输出不含"关联:"行
  - 有 metadata：按 key 字母序输出 `  <key>: <value>`
  - 空对象视同无（formatter 防御性判空）

**不新增**：

- `harness-todo-list` 表格渲染：SKILL.md 自然语言指令，不在 ts 层测；靠人眼验收。
- `recovery.ts` / `buildFirstMessage`：行为不变，原测试继续保护。

**回归兜底**：

- `tests/store.test.ts::makeTodo()` 辅助函数不改（可选字段向后兼容）
- `polling.test.ts` / `lookup.test.ts` / `recovery.test.ts`：不 touch，跑绿即证明无回归

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/types.ts` | `TodoItem` + `NoticeMessage` 各加 `metadata?` 字段 |
| `src/store.ts` | `add` / `update` 加空对象归一化（丢弃 `{}`） |
| `src/services/notice.ts` | `formatNoticeMessage` 追加"关联:"块 |
| `skills/harness-todo-create/SKILL.md` | 加"识别外链"规则段；`store.add` 调用多一个 JSON 参数 |
| `skills/harness-todo-list/SKILL.md` | 表格加 Extras 列的渲染规则 |
| `skills/harness-notice-user/SKILL.md` | 字段映射加 `metadata ← todo.metadata` |
| `tests/store.test.ts` | +3 个 case |
| `tests/services/notice.test.ts` | 新建，2-3 个 case |

## 开放问题

无。所有分歧点在设计讨论中已闭环：开放式 bag（方案 1 / 字符串值），创建时一次性写入，list + notice 双端默认渲染。
