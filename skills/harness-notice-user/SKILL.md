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
import { TodoStore } from '<pluginRoot>/src/store.ts';
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
import { getLastConversationTurn } from '<pluginRoot>/src/services/session-log.ts';
const turn = getLastConversationTurn(process.argv[1]);
if (!turn) { console.error('无法提取最后一轮对话'); process.exit(1); }
console.log(JSON.stringify(turn));
" "<transcriptPath>"
```

输出 JSON：`{ userMessage, assistantMessage }`。

### 3. 生成摘要

基于上一步的 `userMessage` 和 `assistantMessage`，生成中文摘要。先判断 `assistantMessage` 属于哪一类：

- **结论型**（已完成、已得出答案、已给出判断）：摘要尽可能完整保留结论——关键结果、数据、文件路径、判定都要带上；若原文本身已足够精炼，可直接原样输出。**不要**为了凑字数而裁剪结论信息。
- **提问型 / 待决策型**（assistant 在向用户提问、列出选项、请求确认）：直接原样输出 assistant 的问题或选项，保持用户能一眼看清"要我回答什么"。
- **其他（进行中、描述动作）**：生成 50–100 字概括，突出"做了什么 / 在等什么"。

通用约束：

- 单段，不分行
- 不含代码块、不含 markdown 列表
- 结论型 / 提问型允许超过 100 字，以信息完整为先

### 4. 组装 NoticeMessage 并发送

字段映射：
- `title` ← `todo.title`
- `status` ← `todo.status`（值域 `pending | running | done | failed`）
- `summary` ← 上一步生成的摘要
- `tmuxSessionId` ← `todo.tmuxSessionId`
- `remoteControlUrl` ← `todo.remoteControlUrl`

#### 4a. 检查自定义渠道

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

- **输出 `true`**：调用 `runHooks` 执行配置的 hooks，**跳过** 4b 的默认控制台输出：

  ```bash
  npx --yes tsx -e "
  import { runHooks } from '<pluginRoot>/src/services/hooks.ts';
  (async () => {
    await runHooks(process.argv[1], 'notice-user', JSON.parse(process.argv[2]));
  })();
  " "<cwd>" '<NoticeMessage JSON>'
  ```

- **输出 `false`**：走默认渠道（4b）。

#### 4b. 默认渠道（控制台输出）

```bash
npx --yes tsx -e "
import { formatNoticeMessage } from '<pluginRoot>/src/services/notice.ts';
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
