# TodoItem Metadata Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `TodoItem` 加一个可选 `metadata` 字段（开放式字符串 bag），让创建时自动抽出的外链（meego/jira/...）得以结构化存储，并在 `harness-todo-list` 和 `harness-notice-user` 默认渲染。

**Architecture:** 改动围绕一个可选字段展开：`TodoItem.metadata?: Record<string, string>`。`TodoStore` 做空对象归一化保证持久化形态唯一；`formatNoticeMessage` 在非空时追加"关联:"块；三个 SKILL.md（create/list/notice-user）各改一段渲染或写入规则。Agent 上下文边界不变（`buildFirstMessage` / `recovery.ts` 不读 metadata）。

**Tech Stack:** TypeScript 5.7, vitest 3, Node 22, tsx。

**Spec:** `docs/superpowers/specs/2026-04-23-todo-metadata-extension-design.md`

---

## File Map

- **Modify**: `src/types.ts` — `TodoItem` 与 `NoticeMessage` 各加 `metadata?` 字段
- **Modify**: `src/store.ts` — `add` / `update` 空对象归一化
- **Modify**: `src/services/notice.ts` — `formatNoticeMessage` 追加"关联:"块
- **Modify**: `skills/harness-todo-create/SKILL.md` — URL 识别规则 + `store.add` 调用加第 4 个 JSON 参数
- **Modify**: `skills/harness-todo-list/SKILL.md` — 表格 Extras 列 + 单元格渲染规则
- **Modify**: `skills/harness-notice-user/SKILL.md` — 字段映射加 `metadata ← todo.metadata`
- **Modify**: `tests/store.test.ts` — +3 个 case（metadata round-trip、add 空对象归一化、update 空对象归一化 + 替换语义）
- **Create**: `tests/services/notice.test.ts` — 3 个 case（metadata 渲染、无 metadata、空 metadata）

---

## Task 1: Add `metadata` field to `TodoItem`

**Files:**
- Modify: `src/types.ts:3-13`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write the failing test**

在 `tests/store.test.ts` 的最后一个 `it(...)` 之后、`});` 关闭 `describe` 之前，插入：

```ts
  it("round-trips metadata field", () => {
    const todo = makeTodo({
      id: "meta-1",
      metadata: { meego: "https://meego.feishu.cn/story/123", code: "https://github.com/foo/bar/pull/42" },
    });
    store.add(todo);
    const got = store.get("meta-1");
    expect(got?.metadata).toEqual({
      meego: "https://meego.feishu.cn/story/123",
      code: "https://github.com/foo/bar/pull/42",
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/store.test.ts`
Expected: **TypeScript error** — `Object literal may only specify known properties, and 'metadata' does not exist in type 'Partial<TodoItem>'`.

- [ ] **Step 3: Add `metadata?` to `TodoItem`**

Edit `src/types.ts`, change the `TodoItem` interface (lines 3-13) to:

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
  metadata?: Record<string, string>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/store.test.ts`
Expected: PASS. All existing tests also still pass (the field is optional).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/store.test.ts
git commit -m "feat(types): add optional metadata bag to TodoItem"
```

---

## Task 2: Empty metadata normalization in `TodoStore.add`

**Why:** 当 create skill 识别不到任何外链时会传 `metadata: {}`。落盘的 `todos.json` 不应出现 `"metadata": {}` 噪音，读回也应统一为 `undefined`。

**Files:**
- Modify: `src/store.ts:40-44`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write the failing test**

在 `tests/store.test.ts` 新增 case，放在 Task 1 新增的 round-trip 之后：

```ts
  it("drops empty metadata object on add", () => {
    store.add(makeTodo({ id: "empty-1", metadata: {} }));
    const got = store.get("empty-1");
    expect(got?.metadata).toBeUndefined();

    const raw = fs.readFileSync(path.join(tmpDir, ".harness", "todos.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed[0]).not.toHaveProperty("metadata");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/store.test.ts`
Expected: FAIL — `expected {...metadata: {}} not to have property "metadata"`. Currently `add` writes `metadata: {}` through unchanged.

- [ ] **Step 3: Modify `TodoStore.add` to normalize empty metadata**

Edit `src/store.ts`, replace the `add` method (lines 40-44):

```ts
  add(todo: TodoItem): void {
    const items = this.read();
    const normalized = { ...todo };
    if (normalized.metadata && Object.keys(normalized.metadata).length === 0) {
      delete normalized.metadata;
    }
    items.push(normalized);
    this.write(items);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/store.test.ts`
Expected: PASS. All earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat(store): drop empty metadata object on add"
```

---

## Task 3: Empty metadata normalization in `TodoStore.update` + replacement-semantics guard

**Why:** `update` 用 spread shallow-merge；传 `metadata: {}` 会把已有的 metadata 覆盖为空对象。归一化规则要和 `add` 对齐。顺带补一个 guard 测试锁住"metadata 整体替换、不 deep-merge"的语义（当前行为，不想悄悄漂走）。

**Files:**
- Modify: `src/store.ts:46-52`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write the failing test for empty-object normalization**

在 `tests/store.test.ts` 新增：

```ts
  it("drops empty metadata object on update", () => {
    store.add(makeTodo({ id: "clr-1", metadata: { meego: "https://x" } }));
    store.update("clr-1", { metadata: {} });
    const got = store.get("clr-1");
    expect(got?.metadata).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/store.test.ts`
Expected: FAIL — `metadata` 被覆盖成 `{}` 而不是 `undefined`。

- [ ] **Step 3: Modify `TodoStore.update` to normalize empty metadata**

Edit `src/store.ts`, replace the `update` method (lines 46-52):

```ts
  update(id: string, updates: Partial<Omit<TodoItem, "id">>): void {
    const items = this.read();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return;
    const merged = { ...items[index], ...updates };
    if (merged.metadata && Object.keys(merged.metadata).length === 0) {
      delete merged.metadata;
    }
    items[index] = merged;
    this.write(items);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Add guard test for replacement semantics**

继续在 `tests/store.test.ts` 追加：

```ts
  it("replaces metadata wholesale on update (no deep-merge)", () => {
    store.add(makeTodo({ id: "rep-1", metadata: { meego: "https://old", jira: "https://j" } }));
    store.update("rep-1", { metadata: { meego: "https://new" } });
    const got = store.get("rep-1");
    expect(got?.metadata).toEqual({ meego: "https://new" });
  });
```

- [ ] **Step 6: Run all store tests**

Run: `npm test -- tests/store.test.ts`
Expected: PASS. Guard test passes without further code change (current spread already replaces).

- [ ] **Step 7: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat(store): normalize empty metadata on update; guard replacement semantics"
```

---

## Task 4: Add `metadata` to `NoticeMessage` and render in `formatNoticeMessage`

> **⚠ 执行时的 drift**：本 plan 起稿时 `NoticeMessage` 的字段是 `summary: string`，`tests/services/notice.test.ts` 不存在。执行期间历史 commit `3f5b133 feat: 调整notice方式` 落地，把 `NoticeMessage` 改为 `userMessage + assistantMessage` 两字段，且已创建 `tests/services/notice.test.ts`。**实际执行版本**（commit `2f42411`）做了对齐：保留 `userMessage`/`assistantMessage` 行不动、只追加 `metadata?` 字段与"关联:"块；测试文件是 Modify 而非 Create。下方代码块是起稿时的历史版本，真实落地以 commit `2f42411` 为准。

**Files:**
- Modify: `src/types.ts:15-21`
- Modify: `src/services/notice.ts:3-11`
- Modify: `tests/services/notice.test.ts`（执行时该文件已存在；原 plan 写的是 Create）

- [ ] **Step 1: Write the failing test (new file)**

Create `tests/services/notice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatNoticeMessage } from "../../src/services/notice.js";

describe("formatNoticeMessage", () => {
  const base = {
    title: "实现登录",
    status: "done",
    summary: "已完成",
    tmuxSessionId: "harness-abc",
    remoteControlUrl: "https://claude.ai/code/session_xxx",
  };

  it("renders metadata block when metadata is non-empty, sorted by key", () => {
    const out = formatNoticeMessage({
      ...base,
      metadata: { meego: "https://meego.feishu.cn/1", code: "https://github.com/x/y/pull/1" },
    });
    expect(out).toContain("关联:");
    // key 字母序：code 在 meego 之前
    const codeIdx = out.indexOf("  code: https://github.com/x/y/pull/1");
    const meegoIdx = out.indexOf("  meego: https://meego.feishu.cn/1");
    expect(codeIdx).toBeGreaterThan(-1);
    expect(meegoIdx).toBeGreaterThan(codeIdx);
  });

  it("omits metadata block when metadata is absent", () => {
    const out = formatNoticeMessage(base);
    expect(out).not.toContain("关联:");
  });

  it("omits metadata block when metadata is an empty object", () => {
    const out = formatNoticeMessage({ ...base, metadata: {} });
    expect(out).not.toContain("关联:");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/services/notice.test.ts`
Expected: **TypeScript error** — `Object literal may only specify known properties, and 'metadata' does not exist in type 'NoticeMessage'`.

- [ ] **Step 3: Add `metadata?` to `NoticeMessage`**

Edit `src/types.ts`, replace the `NoticeMessage` interface (lines 15-21):

```ts
export interface NoticeMessage {
  title: string;
  status: string;
  summary: string;
  tmuxSessionId: string;
  remoteControlUrl: string;
  metadata?: Record<string, string>;
}
```

- [ ] **Step 4: Run test to verify it fails for the right reason**

Run: `npm test -- tests/services/notice.test.ts`
Expected: First test FAILS with `expected "..." to contain "关联:"` (type error gone, rendering still missing). Other two tests PASS.

- [ ] **Step 5: Update `formatNoticeMessage` to render metadata block**

Edit `src/services/notice.ts`, replace lines 3-11:

```ts
export function formatNoticeMessage(message: NoticeMessage): string {
  const lines = [
    `📋 ${message.title}`,
    `状态: ${message.status}`,
    `摘要: ${message.summary}`,
    `Tmux Session: ${message.tmuxSessionId}`,
    `Remote URL: ${message.remoteControlUrl}`,
  ];
  if (message.metadata && Object.keys(message.metadata).length > 0) {
    lines.push("关联:");
    for (const key of Object.keys(message.metadata).sort()) {
      lines.push(`  ${key}: ${message.metadata[key]}`);
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 6: Run all notice tests**

Run: `npm test -- tests/services/notice.test.ts`
Expected: All three tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/services/notice.ts tests/services/notice.test.ts
git commit -m "feat(notice): render metadata block in formatNoticeMessage"
```

---

## Task 5: Update `harness-todo-create` SKILL.md — URL 识别 + 写入 metadata

**Files:**
- Modify: `skills/harness-todo-create/SKILL.md`

No code tests — SKILL.md 是给 Agent 读的自然语言指令。本任务是文档编辑。

- [ ] **Step 1: 在"### 1. 分析描述"段末尾插入 URL 识别规则**

Edit `skills/harness-todo-create/SKILL.md`, 找到 `### 1. 分析描述` 段（在 "根据描述内容，总结生成一个简短的标题" 这一 bullet 之后），新增：

```markdown
- 扫描描述中所有 `http(s)://…` URL，按 host 映射到 metadata key，填入后续步骤的 `metadata` 参数：
  - host 含 `meego.feishu.cn` 或 `meego.` → key = `meego`
  - host 含 `atlassian.net` 或 `jira.` → key = `jira`
  - host 是 `github.com` 或以 `.bytedance.net` 结尾 → key = `code`
  - host 含 `figma.com` → key = `figma`
  - 同 key 多次出现取第一次；认不出的 host 跳过（不乱塞）
  - 没识别到任何外链：metadata 传 `{}`（store 层会归一化丢弃）
```

- [ ] **Step 2: 改"### 2. 创建待办项记录"里的 bash 块，加第 4 个 JSON 参数**

继续 edit 同一文件，把第 2 段里的 `npx tsx -e "..."` 块替换为：

````markdown
```bash
npx tsx -e "
import { generateId } from '<plugin-dir>/src/utils/id.ts';
import { TodoStore } from '<plugin-dir>/src/store.ts';
const store = new TodoStore(process.argv[1]);
const id = generateId();
store.add({
  id,
  title: process.argv[2],
  description: process.argv[3],
  status: 'pending',
  tmuxSessionId: '',
  remoteControlUrl: '',
  claudeSessionId: '',
  claudeSessionName: '',
  firstMessageSent: false,
  metadata: JSON.parse(process.argv[4] || '{}'),
});
console.log(id);
" "<cwd>" "<title>" "<description>" '<metadata-json>'
```

其中 `<metadata-json>` 是第 1 步识别出的 metadata 对象的 JSON 字符串，例如 `{"meego":"https://meego.feishu.cn/story/detail/123"}`；没识别到就传 `{}`。
````

- [ ] **Step 3: 人眼 review**

打开 `skills/harness-todo-create/SKILL.md`，确认：
- URL 识别规则段出现在 "### 1. 分析描述" 末尾
- 第 2 段的 bash 块含 `metadata: JSON.parse(process.argv[4] || '{}')` 和对应的第 4 个位置参数
- 其余段落（3、4、5）未被误伤

- [ ] **Step 4: Commit**

```bash
git add skills/harness-todo-create/SKILL.md
git commit -m "feat(skill): extract URLs into metadata on todo create"
```

---

## Task 6: Update `harness-todo-list` SKILL.md — Extras 列

**Files:**
- Modify: `skills/harness-todo-list/SKILL.md`

- [ ] **Step 1: 在表格列定义表里加 Extras 行**

Edit `skills/harness-todo-list/SKILL.md`, 把"列定义如下"下方的 Markdown 表格替换为：

```markdown
| 列名 | 字段 | 说明 |
|------|------|------|
| # | 数组下标 + 1 | 1-based 序号，按 `store.list()` 返回顺序 |
| Status | `status` | 用 emoji 标记：⚪ pending, 🔵 running, 🟢 done, 🔴 failed |
| Title | `title` | 待办项标题 |
| ID | `id` | 待办项 ID |
| Tmux Session | `tmuxSessionId` | tmux 会话标识 |
| Remote URL | `remoteControlUrl` | 远程控制链接 |
| Extras | `metadata` | 外链 bag（按规则渲染，详见下文） |
```

- [ ] **Step 2: 新增 Extras 渲染规则段**

继续 edit 同一文件，在"> 序号（#）是展示时的临时索引..."那一段之后、"## 输出示例"之前，新增：

```markdown
## Extras 单元格渲染规则

- `metadata` 为 `undefined` 或空对象：单元格输出 `—`（em dash）
- 否则遍历键值对（**按 key 字母序**）：
  - 值以 `http://` 或 `https://` 开头：渲染为 `[key](value)`
  - 否则：渲染为 `key: value`
- 多个条目用 `<br>` 分隔
```

- [ ] **Step 3: 更新"## 输出示例"区块**

把原有的 `## 输出示例` 段替换为带 Extras 列的版本：

````markdown
## 输出示例

```markdown
| # | Status | Title | ID | Tmux Session | Remote URL | Extras |
|---|--------|-------|----|--------------|------------|--------|
| 1 | 🔵 running | 实现登录功能 | abc123 | harness-abc123 | https://... | [code](https://github.com/x/y/pull/1)<br>[meego](https://meego.feishu.cn/1) |
| 2 | ⚪ pending | 添加单元测试 | def456 | harness-def456 | https://... | — |
```
````

- [ ] **Step 4: 人眼 review**

确认列定义表、渲染规则段、输出示例三处一致都有 Extras 列，且单元格规则的描述与示例中 `[code](...)<br>[meego](...)` 相符（字母序 + linkify + `<br>` 分隔）。

- [ ] **Step 5: Commit**

```bash
git add skills/harness-todo-list/SKILL.md
git commit -m "feat(skill): add Extras column rendering metadata in todo-list"
```

---

## Task 7: Update `harness-notice-user` SKILL.md — metadata 透传

> **⚠ 执行时的 drift**：起稿时 SKILL.md 里的组装段标题是 `### 4. 组装 NoticeMessage 并发送`；历史 commit `3f5b133` 把文件重构后，现实中的标题是 `### 3. 组装 NoticeMessage`，且字段映射列表里的字段已从 `summary` 改成 `userMessage + assistantMessage`。**实际执行版本**（commit `00c08ad`）是在 `### 3. 组装 NoticeMessage` 的字段映射末尾追加 `metadata ← todo.metadata` 一行；4a/4b/4c 的 bash 块未动。下方 Step 2 里写的 `### 4. 组装 NoticeMessage 并发送` 是起稿时的历史引用，真实落地以 commit `00c08ad` 为准。

**Files:**
- Modify: `skills/harness-notice-user/SKILL.md`

- [ ] **Step 1: 改"### 1. 读取待办项"的 JSON 字段说明**

Edit `skills/harness-notice-user/SKILL.md`，把第 1 步最后一行"输出的 JSON 字段：`id, title, description, status, tmuxSessionId, remoteControlUrl, claudeSessionId, claudeSessionName`。"替换为：

```markdown
输出的 JSON 字段：`id, title, description, status, tmuxSessionId, remoteControlUrl, claudeSessionId, claudeSessionName, metadata`（`metadata` 可选，字段缺失代表无外链）。
```

- [ ] **Step 2: 在"### 4. 组装 NoticeMessage 并发送"的字段映射里加一行**

继续 edit，找到"字段映射："下面的列表，在最后一行 `remoteControlUrl ← todo.remoteControlUrl` 之后追加：

```markdown
- `metadata` ← `todo.metadata`（可能 `undefined`，保持 `undefined` 透传，**不要**手动补成 `{}`）
```

- [ ] **Step 3: 人眼 review**

确认：
- 第 1 步的 JSON 字段列表多了 `metadata`
- 第 4 步字段映射多了 `metadata` 那行
- 4a/4b 控制台/hook 分流逻辑未被误伤
- 不需要改 bash 块——`JSON.stringify(todo)` 自然会带 metadata

- [ ] **Step 4: Commit**

```bash
git add skills/harness-notice-user/SKILL.md
git commit -m "feat(skill): pass metadata through NoticeMessage"
```

---

## Task 8: Full-suite regression

**Files:** 无改动，只跑测试。

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: 全部 PASS。重点关注没被本次改动 touch 的套件（`polling.test.ts`、`lookup.test.ts`、`recovery.test.ts`、`message.test.ts`）是否有回归——应全部沿用 `makeTodo()` 工厂的默认值，不受 `metadata?` 可选字段影响。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 如有失败，逐个修**

如果有意外失败（例如其它测试文件里的 `makeTodo` 工厂 TypeScript 不兼容）：先读失败信息，再决定改法。大概率不会有——`metadata?` 是可选字段，老工厂返回的对象依然合法。

- [ ] **Step 4: 无改动需要提交时跳过**

如果前面 Task 1–7 已逐步 commit 干净，这里无需再 commit。

---

## Self-Review

**1. Spec coverage：**
- 段 1 / Schema 与持久化：Task 1（TodoItem.metadata）、Task 2+3（空对象归一化）✓
- 段 2 / create skill URL 解析与写入：Task 5 ✓
- 段 3 / list Extras 列：Task 6 ✓
- 段 4 / NoticeMessage 透传 + formatter：Task 4 + Task 7 ✓
- 段 5 / 测试：Task 1/2/3（store 3 case）+ Task 4（notice 3 case）✓
- "不变的边界"（`buildFirstMessage` / `recovery.ts` / `lookup.ts` 不动）：本 plan 未触碰这些文件，Task 8 的全量 regression 兜底 ✓

**2. Placeholder scan：** 无 TBD/TODO/占位词；所有 code block 含完整可执行内容；所有 test step 含实际断言。

**3. Type consistency：**
- `TodoItem.metadata` 与 `NoticeMessage.metadata` 均为 `Record<string, string>` ✓
- `formatNoticeMessage` 读 `message.metadata` 与 `NoticeMessage` 定义一致 ✓
- `store.add` / `store.update` 的 `metadata` 规范化逻辑中 `Object.keys(...).length === 0` 判空条件一致 ✓
- SKILL.md 中 bash 块的 `metadata: JSON.parse(process.argv[4] || '{}')` 与 store 的空对象归一化配合闭环（传 `{}` 也不会脏化 JSON）✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-todo-metadata-extension.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 每个 task 派发一个 fresh subagent，task 间我来 review，迭代更快、上下文干净
2. **Inline Execution** — 在当前 session 里顺序执行，带 checkpoint 让你中途 review

Which approach?
