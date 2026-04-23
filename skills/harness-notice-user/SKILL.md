---
name: harness-notice-user
description: "Send a notification message about a harness todo item's status. Reads the Claude session JSONL log to extract the last conversation turn, forwards the raw user/assistant messages, and sends them through the configured message channel. Use when a harness session ends and needs to notify the user."
---

# Harness Notice User

> **⚠️ Deprecated（0.1.31+）**
>
> 自 0.1.31 起 Stop hook 直接用 `src/scripts/on-stop-dispatch.ts` 走 shell 直出路径，端到端耗时从 25–40s 降到 3–5s，**不再经过本 skill**。
> 本 skill 仅为向后兼容保留：手工排障、旧 on-stop.sh 或第三方调用方才会走到。新链路请直接调用 dispatch 脚本，不要在提示词里拼 `调用 harness-notice-user skill`。

发送 harness 待办项的状态通知。从 Claude 会话日志中提取最后一轮对话，原样透传 userMessage / assistantMessage 并推送（**不做摘要**，避免 LLM 多一轮推理）。

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
import { TodoStore } from '<pluginRoot>/src/store.ts';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (!todo) { console.error('待办项不存在'); process.exit(1); }
console.log(JSON.stringify(todo));
" "<cwd>" "<todoId>"
```

输出的 JSON 字段：`id, title, description, status, tmuxSessionId, remoteControlUrl, claudeSessionId, claudeSessionName, metadata`（`metadata` 可选，字段缺失代表无外链）。

### 2. 提取最后一轮对话

直接使用调用方传入的 `transcriptPath`，**不要**再去 `findSessionLogFile` 猜：

```bash
npx --yes tsx -e "
import { getLastConversationTurn } from '<pluginRoot>/src/services/session-log.ts';
const turn = getLastConversationTurn(process.argv[1]);
if (!turn) { console.error('无法提取最后一轮对话'); process.exit(1); }
console.log(JSON.stringify(turn));
" "<transcriptPath>"
```

输出 JSON：`{ userMessage, assistantMessage }`。

### 3. 组装 NoticeMessage

**不要**生成摘要——上一步拿到的 `userMessage` / `assistantMessage` 原文直接作为独立字段透传，避免 LLM 再多一轮推理拖慢响应。

字段映射：
- `title` ← `todo.title`
- `status` ← `todo.status`（值域 `pending | running | done | failed`）
- `userMessage` ← 上一步 `turn.userMessage` 原文（不裁剪、不改写）
- `assistantMessage` ← 上一步 `turn.assistantMessage` 原文（不裁剪、不改写）
- `tmuxSessionId` ← `todo.tmuxSessionId`
- `remoteControlUrl` ← `todo.remoteControlUrl`
- `metadata` ← `todo.metadata`（可能 `undefined`，保持 `undefined` 透传，**不要**手动补成 `{}`）

> **重要**：`userMessage` / `assistantMessage` 是透传的用户原文，可能包含引号、反引号、`$`、换行等任意字符。下一步发送时**一律用 heredoc + stdin 管道**传 JSON，不要把原文塞到命令行参数里——否则 shell 会把内容当代码解析。

### 4. 发送通知

#### 4a. 检查是否配置了自定义渠道

读取 `<cwd>/.harness/config.json`，检查 `notice-user` 事件是否有 hook 配置：

```bash
npx --yes tsx -e "
import fs from 'node:fs';
import path from 'node:path';
const configPath = path.join(process.argv[1], '.harness', 'config.json');
if (!fs.existsSync(configPath)) { console.log('false'); process.exit(0); }
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const hooks = config.hooks?.['notice-user'];
  console.log(hooks && hooks.length > 0 ? 'true' : 'false');
} catch { console.log('false'); }
" "<cwd>"
```

- **输出 `true`** → 走 4b（自定义渠道）
- **输出 `false`** → 走 4c（默认控制台）

以下两种渠道都通过 heredoc `<<'NOTICE_EOF'` 把 NoticeMessage JSON 从 stdin 灌入；单引号包裹的分隔符保证 heredoc 内容按字面传递，不做任何变量展开或命令替换。

#### 4b. 自定义渠道（走 hooks）

```bash
npx --yes tsx -e "
import { readFileSync } from 'node:fs';
import { runHooks } from '<pluginRoot>/src/services/hooks.ts';
(async () => {
  const payload = JSON.parse(readFileSync(0, 'utf-8'));
  await runHooks(process.argv[1], 'notice-user', payload);
})();
" "<cwd>" <<'NOTICE_EOF'
<NoticeMessage JSON 原样写在这里，多行亦可>
NOTICE_EOF
```

#### 4c. 默认渠道（控制台输出）

```bash
npx --yes tsx -e "
import { readFileSync } from 'node:fs';
import { formatNoticeMessage } from '<pluginRoot>/src/services/notice.ts';
const payload = JSON.parse(readFileSync(0, 'utf-8'));
console.log(formatNoticeMessage(payload));
" <<'NOTICE_EOF'
<NoticeMessage JSON 原样写在这里，多行亦可>
NOTICE_EOF
```

stdout 会被 tmux 通知会话承接显示。

### 5. 退出

完成第 4 步后**立即结束响应**。本 skill 在 `claude -p` 非交互模式下被调用，不要追加询问、不要等待输入。
