# Stop Hook 自动通知 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 注册 Stop hook，在 harness 管理的 tmux 会话内 Claude 完成一轮响应时，派发一个独立的临时 tmux 会话执行 `harness-notice-user` skill 推送通知。

**Architecture:** 插件根目录新增 `hooks/hooks.json` 自动注册 Stop hook → `scripts/on-stop.sh` 处理事件、查 todoId、派发独立 tmux 会话 → 新会话内 `claude -p` 调用 skill 完成生成 + 发送 + 退出。skill SKILL.md 同步优化（显式输入、`pluginRoot` 取代 `<plugin-dir>` 占位、用 hook 传入的 transcriptPath 取代会话查找）。

**Tech Stack:** bash, tmux, jq, Node 18+ (`npx tsx` 已在 hook/scripts 既有用法), Claude Code Plugins hook 协议

**Spec:** `docs/superpowers/specs/2026-04-13-stop-hook-notification-design.md`

> **Implementation note —— 关于"测试"：**
> 本插件没有针对 shell hook 的自动化测试体系（vitest 只覆盖 `src/`）。本计划对 shell / JSON / markdown 改动采用**验证驱动**（每步骤跑明确命令并比对输出）替代 strict TDD；对涉及 `src/` 的部分若需要会按 vitest 习惯加测试。这是务实选择，不要勉强为 hooks.json 这种纯配置文件造单元测试。

---

## 文件结构

**新增：**
- `hooks/hooks.json` —— 声明 Stop hook，自动注册（参考 `claude-code-warp` 模式）
- `scripts/on-stop.sh` —— Stop 事件处理脚本：前缀过滤、防重入、查 todoId、派发通知会话

**修改：**
- `skills/harness-notice-user/SKILL.md` —— 输入扩展为 `{todoId, cwd, transcriptPath, pluginRoot}`；占位符替换；摘要约束；执行/退出语义

**删除：**
- `hook/on-session-end.sh` —— 文件名与行为不符、从未被注册

**注：** `.claude-plugin/plugin.json` 不需要改 —— Claude Code 插件运行时自动发现 `hooks/hooks.json`，无需在 plugin.json 里登记。

---

## Task 1: 删除老的 on-session-end.sh

**Files:**
- Delete: `hook/on-session-end.sh`

- [ ] **Step 1: 确认文件存在且未被引用**

Run: `git ls-files | grep -E '(on-session-end|hook/)'`
Expected: 仅列出 `hook/on-session-end.sh`

Run（用 Grep 工具）：搜索整个仓库（除 `node_modules`、`docs/superpowers/specs` 之外）有没有引用 `on-session-end.sh`
Expected: 仅 `README.md` 第 24 行的安装说明片段提到它

- [ ] **Step 2: 删除文件**

```bash
git rm hook/on-session-end.sh
```

- [ ] **Step 3: 同步移除 README 中的旧 hook 安装说明**

修改 `README.md` 第 13–28 行的 `## Hook Setup` 段落。新内容：

```markdown
## Hook Setup

This plugin registers a `Stop` hook automatically via `hooks/hooks.json`. No manual `settings.json` configuration is required.

The hook fires when Claude finishes a turn inside a tmux session whose name starts with `harness-`. It dispatches a separate ephemeral tmux session that runs Claude with the `harness-notice-user` skill to generate and deliver a notification.
```

- [ ] **Step 4: 验证 `hook/` 目录是否还有别的文件，如无则同时清理**

Run: `ls hook/ 2>/dev/null || echo EMPTY`
Expected: `EMPTY` 或者 `ls: hook/: No such file or directory`

如果目录已空，git 会自动忽略空目录，无需额外操作。

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "chore: remove unused hook/on-session-end.sh and stale README hook setup"
```

---

## Task 2: 新增 hooks/hooks.json

**Files:**
- Create: `hooks/hooks.json`

- [ ] **Step 1: 创建目录与文件**

```bash
mkdir -p hooks
```

写入 `hooks/hooks.json`：

```json
{
  "description": "Easy Harness session notifications",
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.sh"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: 验证 JSON 合法**

Run: `jq . hooks/hooks.json`
Expected: 输出格式化后的 JSON，无解析错误

- [ ] **Step 3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat: register Stop hook via hooks/hooks.json"
```

---

## Task 3: 新增 scripts/on-stop.sh —— 早退分支

先用最小骨架处理所有应该早退（exit 0）的分支，确保没有 todoId 时干净退出。后续 Task 4 再补"派发新会话"主流程。

**Files:**
- Create: `scripts/on-stop.sh`

- [ ] **Step 1: 创建目录与文件骨架**

```bash
mkdir -p scripts
```

写入 `scripts/on-stop.sh`：

```bash
#!/bin/bash
# Stop hook —— 在 harness-* tmux 会话内 Claude 完成一轮时派发通知会话
# 所有失败 / 不适用情况均静默 exit 0，绝不影响主会话

set -u

# 1. 必须在 tmux 内
if [ -z "${TMUX:-}" ]; then
  exit 0
fi

# 2. tmux session 必须以 harness- 开头（限定范围 + 防递归）
TMUX_SESSION=$(tmux display-message -p '#S' 2>/dev/null || echo "")
case "$TMUX_SESSION" in
  harness-*) ;;
  *) exit 0 ;;
esac

# 3. 读 stdin JSON
INPUT=$(cat)

# 4. 防 Stop 套 Stop
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

# 5. 拿 cwd / transcript_path
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
if [ -z "$CWD" ]; then
  exit 0
fi

# 6. 后续：查 todoId、派发通知会话（Task 4 实现）
exit 0
```

- [ ] **Step 2: 加可执行权限**

```bash
chmod +x scripts/on-stop.sh
```

- [ ] **Step 3: 验证 shebang 与语法**

Run: `bash -n scripts/on-stop.sh && echo OK`
Expected: `OK`

- [ ] **Step 4: 模拟"不在 tmux"早退**

Run:
```bash
unset TMUX
echo '{}' | scripts/on-stop.sh
echo "exit=$?"
```
Expected: `exit=0`，无任何 stdout/stderr

- [ ] **Step 5: 模拟"非 harness 会话"早退**

Run:
```bash
TMUX=fake/session,1234,0 \
  bash -c 'tmux() { case "$*" in *display-message*) echo "random-session";; esac; }; export -f tmux; echo "{}" | scripts/on-stop.sh; echo "exit=$?"'
```
Expected: `exit=0`，无 stdout

> 注：这里用 `bash -c` + 函数 mock `tmux` 命令模拟 `display-message` 输出。下同。

- [ ] **Step 6: 模拟 stop_hook_active=true 早退**

Run:
```bash
TMUX=fake bash -c 'tmux() { case "$*" in *display-message*) echo "harness-foo";; esac; }; export -f tmux; echo "{\"stop_hook_active\": true}" | scripts/on-stop.sh; echo "exit=$?"'
```
Expected: `exit=0`

- [ ] **Step 7: 模拟 cwd 缺失早退**

Run:
```bash
TMUX=fake bash -c 'tmux() { case "$*" in *display-message*) echo "harness-foo";; esac; }; export -f tmux; echo "{}" | scripts/on-stop.sh; echo "exit=$?"'
```
Expected: `exit=0`

- [ ] **Step 8: Commit**

```bash
git add scripts/on-stop.sh
git commit -m "feat: scripts/on-stop.sh skeleton with all early-exit branches"
```

---

## Task 4: scripts/on-stop.sh —— 查 todoId + 派发通知会话

**Files:**
- Modify: `scripts/on-stop.sh`

- [ ] **Step 1: 替换文件末尾的占位 `exit 0` 为完整逻辑**

把 `scripts/on-stop.sh` 末尾这两行：

```bash
# 6. 后续：查 todoId、派发通知会话（Task 4 实现）
exit 0
```

替换为：

```bash
# 6. 从 tmux session 名查 todoId
TODO_ID=$(npx --yes tsx -e "
  import { TodoStore } from '${CLAUDE_PLUGIN_ROOT}/src/store.js';
  const store = new TodoStore(process.argv[1]);
  const todo = store.list().find(t => t.tmuxSessionId === process.argv[2]);
  if (todo) console.log(todo.id);
" "$CWD" "$TMUX_SESSION" 2>/dev/null)

if [ -z "$TODO_ID" ]; then
  exit 0
fi

# 7. 派发通知会话（名字不以 harness- 开头，避免 hook 递归触发）
TS=$(date +%s)
NOTICE_SESSION="notice-${TODO_ID}-${TS}"
PROMPT="调用 harness-notice-user skill。todoId=${TODO_ID}，cwd=${CWD}，transcriptPath=${TRANSCRIPT_PATH}，pluginRoot=${CLAUDE_PLUGIN_ROOT}。执行完后直接退出，不要等待用户输入。"

tmux new-session -d -s "$NOTICE_SESSION" -c "$CWD" \
  "claude -p $(printf '%q' "$PROMPT")" 2>/dev/null || true

exit 0
```

- [ ] **Step 2: 语法检查**

Run: `bash -n scripts/on-stop.sh && echo OK`
Expected: `OK`

- [ ] **Step 3: 端到端冒烟（手动）**

> 这步需要在真实环境跑，agent 执行计划时**不必**自动跑，留给用户验证。把以下命令作为说明保留在 commit message / PR 描述里。

```bash
# 1) 起一个 harness-test tmux 会话
tmux new-session -d -s harness-test "claude"
# 2) 在 .harness/todos.json 里手动添加一条 tmuxSessionId="harness-test" 的 todo
# 3) 在 harness-test 会话里跑任意 prompt，等 claude 回答完
# 4) 应能看到：
tmux ls
# Expected: 列表里出现 notice-<todoId>-<timestamp> 会话，几秒后该会话执行完 claude -p 自动结束
```

- [ ] **Step 4: Commit**

```bash
git add scripts/on-stop.sh
git commit -m "feat: dispatch notice tmux session from Stop hook"
```

---

## Task 5: 重写 SKILL.md

**Files:**
- Modify: `skills/harness-notice-user/SKILL.md`

- [ ] **Step 1: 完整覆盖 SKILL.md 内容**

整文件覆盖为：

````markdown
---
name: harness-notice-user
description: "Send a notification message about a harness todo item's status. Reads the Claude session JSONL log to extract the last conversation turn, generates a summary, and sends it through the configured message channel. Use when a harness session ends and needs to notify the user."
---

# Harness Notice User

发送 harness 待办项的状态通知。从 Claude 会话日志中提取最后一轮对话，生成摘要并推送。

## 输入

调用方（通常是 `scripts/on-stop.sh` 在 prompt 里描述）必须提供以下四个参数：

- `todoId` —— 待办项 ID
- `cwd` —— 待办项所在工作目录（用于定位 `.harness/todos.json`）
- `transcriptPath` —— 当前 Claude 会话的 transcript JSONL 文件绝对路径
- `pluginRoot` —— easy-harness 插件根目录绝对路径

## 处理流程

### 1. 读取待办项

```bash
npx --yes tsx -e "
import { TodoStore } from '<pluginRoot>/src/store.js';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (!todo) { console.error('待办项不存在'); process.exit(1); }
console.log(JSON.stringify(todo));
" "<cwd>" "<todoId>"
```

输出的 JSON 字段：`id, title, description, status, tmuxSessionId, remoteControlUrl, claudeSessionId, claudeSessionName`。

### 2. 提取最后一轮对话

直接使用调用方传入的 `transcriptPath`，**不要**再去 `findSessionLogFile` 猜：

```bash
npx --yes tsx -e "
import { getLastConversationTurn } from '<pluginRoot>/src/services/session-log.js';
const turn = getLastConversationTurn(process.argv[1]);
if (!turn) { console.error('无法提取最后一轮对话'); process.exit(1); }
console.log(JSON.stringify(turn));
" "<transcriptPath>"
```

输出 JSON：`{ userMessage, assistantMessage }`。

### 3. 生成摘要

基于上一步的 `userMessage` 和 `assistantMessage`，自行生成 50–100 字的中文摘要。约束：

- 单段，不分行
- 不含代码块、不含 markdown 列表
- 突出本轮"做了什么 / 等待什么"
- 不要复述对话原文，要概括

### 4. 组装 NoticeMessage 并发送

字段映射：
- `title` ← `todo.title`
- `status` ← `todo.status`（值域 `pending | running | done | failed`）
- `summary` ← 上一步生成的摘要
- `tmuxSessionId` ← `todo.tmuxSessionId`
- `remoteControlUrl` ← `todo.remoteControlUrl`

#### 4a. 检查自定义渠道

判断：当前会话系统提示里"可用 skills 列表"中是否含 `harness-custom-notice-user`。

- **若有**：调用 `harness-custom-notice-user` skill，把上述五个字段作为参数传入（按该 skill 自身约定的格式）。
- **若无**：走默认渠道（4b）。

#### 4b. 默认渠道（控制台输出）

```bash
npx --yes tsx -e "
import { formatNoticeMessage } from '<pluginRoot>/src/services/notice.js';
console.log(formatNoticeMessage({
  title: process.argv[1],
  status: process.argv[2],
  summary: process.argv[3],
  tmuxSessionId: process.argv[4],
  remoteControlUrl: process.argv[5],
}));
" "<title>" "<status>" "<summary>" "<tmuxSessionId>" "<remoteControlUrl>"
```

stdout 会被 tmux 通知会话承接显示。

### 5. 退出

完成第 4 步后**立即结束响应**。本 skill 在 `claude -p` 非交互模式下被调用，不要追加询问、不要等待输入。
````

- [ ] **Step 2: 验证文件被识别为合法 skill（frontmatter 完整）**

Run（Grep 工具）: pattern `^name:|^description:` in `skills/harness-notice-user/SKILL.md`
Expected: 命中 `name:` 一行 + `description:` 一行（文件内 frontmatter 区段）

- [ ] **Step 3: Commit**

```bash
git add skills/harness-notice-user/SKILL.md
git commit -m "feat: refine harness-notice-user skill inputs and execution contract"
```

---

## Task 6: 总结性验证

**Files:** （无改动，纯验证）

- [ ] **Step 1: 复盘文件结构**

Run: `git ls-files hooks/ scripts/ skills/harness-notice-user/ hook/ 2>/dev/null`
Expected:
```
hooks/hooks.json
scripts/on-stop.sh
skills/harness-notice-user/SKILL.md
```
（`hook/` 路径无任何输出，确认旧文件已删除）

- [ ] **Step 2: 复盘 hooks.json 与 on-stop.sh 路径一致**

Run: `jq -r '.hooks.Stop[].hooks[].command' hooks/hooks.json`
Expected: `${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.sh`

Run: `test -x scripts/on-stop.sh && echo executable`
Expected: `executable`

- [ ] **Step 3: 复盘 SKILL.md 不再含 `<plugin-dir>` 占位**

Run（Grep 工具）: pattern `<plugin-dir>` in `skills/harness-notice-user/SKILL.md`
Expected: no matches

- [ ] **Step 4: 复盘 README 不再引用旧 hook 路径**

Run（Grep 工具）: pattern `on-session-end` in 整个仓库（除 `docs/superpowers/`、`node_modules`）
Expected: no matches

- [ ] **Step 5: 跑既有单元测试确认 src/ 没被波及**

Run: `npx vitest run`
Expected: 全绿（本计划没碰 `src/`）

- [ ] **Step 6: 不新建 commit**（本任务全为验证步骤，不留 commit）

---

## 自检（写完后做的）

1. **Spec 覆盖**：
   - hooks.json 自动注册 → Task 2 ✓
   - on-stop.sh 完整逻辑（前缀过滤 / 防递归 / 防重入 / 查 todoId / 派发会话） → Task 3 + Task 4 ✓
   - 删除 `hook/on-session-end.sh` → Task 1 ✓
   - SKILL.md 输入扩展 + 占位替换 + 摘要约束 + 用 transcriptPath + 自定义渠道判断 + 退出语义 → Task 5 ✓
   - README 后续清理（spec 列为非目标，但 Task 1 顺手做了，因为它直接引用了被删除的文件） ✓

2. **占位扫描**：无 TBD/TODO，每个代码步骤有完整代码，每个验证步骤有命令 + 期望输出 ✓

3. **类型/命名一致**：
   - hooks.json 中的 `${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.sh` 对应 Task 3 创建的路径 ✓
   - Task 4 的 prompt 把 `pluginRoot` 传入；Task 5 的 SKILL.md 输入字段也是 `pluginRoot` ✓
   - Task 4 的 `transcriptPath`、Task 5 的输入字段 `transcriptPath`、`getLastConversationTurn(transcriptPath)` 一致 ✓
   - SKILL.md 中 `TodoStore.get(id)` 与 `src/store.ts:36` 实际签名一致 ✓
   - SKILL.md 中 `getLastConversationTurn(filePath)` 与 `src/services/session-log.ts:30` 实际签名一致 ✓
   - SKILL.md 中 `formatNoticeMessage({...})` 字段与 `src/services/notice.ts:3` + `src/types.ts:14` 的 `NoticeMessage` 一致 ✓
