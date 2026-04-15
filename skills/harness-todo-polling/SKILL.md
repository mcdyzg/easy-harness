---
name: harness-todo-polling
description: "Serially dispatch running harness todos via cron-driven tmux send-keys. Records all running todo IDs at start, polls every N minutes (default 1), and sends a user-provided trigger message to the next todo in queue whenever the current focus transitions to pending. Terminates when no todo is running anymore. Use when user wants to automate 'wake up the next todo when the current one is idle' — batch-continue running harness sessions."
---

# Harness Todo Polling

在后台 tmux 会话里跑一个 cron 轮询器，串行调度当前处于 `running` 状态的待办：焦点转 `pending` 就给下一个发 `tmux send-keys` 消息，整表无 `running` 时自终止。

## 输入

用户调用时，skill args 的整段文本按如下规则解析：

1. 匹配第一个出现的 `--interval <N>` 选项（N 为正整数分钟数，默认 1）
2. 剩余文本拼回，trim 后作为 **trigger message**
3. message 为空 → 告知用户并终止（不启动 polling）

示例：

- `/harness-todo-polling 继续下一步` → message = `继续下一步`，interval = 1
- `/harness-todo-polling --interval 5 请根据上一轮结论推进` → message = `请根据上一轮结论推进`，interval = 5

## 处理流程

### 1. 解析参数

从 skill args 里抽出 `--interval <N>` 和 message（见上）。

### 2. 校验 running 数量

```bash
npx --yes tsx -e "
import { TodoStore } from '<pluginRoot>/src/store.ts';
const store = new TodoStore(process.argv[1]);
const n = store.list().filter(t => t.status === 'running').length;
console.log(n);
" "<cwd>"
```

输出的 n：

- `n === 0` → 回复 `暂无 running 待办，无需轮询` 并结束
- `n >= 1` → 继续

### 3. 启动后台 tmux 会话

```bash
TS=$(date +%s)
SESSION="polling-${TS}"
tmux new-session -d -s "$SESSION" -c "<cwd>" \
  "npx --yes tsx '<pluginRoot>/src/scripts/polling.ts' \
     --cwd '<cwd>' --interval <N> --message '<escaped message>'"
```

message 里的单引号需要用 `'\''` 转义，和 `src/services/tmux.ts:buildSendKeysCommand` 的套路保持一致。

### 4. 回显

向用户输出一条确认：

> 已启动轮询会话 `polling-<ts>`，每 <N> 分钟推进一次。
> - `tmux attach -t polling-<ts>` 查看日志
> - `tmux kill-session -t polling-<ts>` 立即终止

然后结束当前 turn。

## 注意事项

- **会话名刻意不以 `harness-` 开头**：避开 `scripts/on-stop.sh` 的递归触发（该 hook 只对 `harness-*` 生效）。
- **并发多个 polling 允许**：会话名带时间戳，互不冲突；但每个都会独立读写 `tmux send-keys`，用户自己留意别把同一个待办同时推两下。
- **本 skill 不做状态修改**：只读 `.harness/todos.json`。trigger 消息本身会让目标会话的 `on-stop` 后续把状态刷到 `pending`（以及 `harness-session-send-user-message` 用户主动发则置 `running`），这些状态流转不由 polling 负责。
- **死会话自动跳过**：polling 期间若某待办的 tmux 会话已丢失（电脑重启等），polling 会日志一行后跳过，不做恢复；恢复责任归 `harness-session-send-user-message`。

## 相关 Skill

- `/harness-todo-list` — 查看待办表格确认谁在 running
- `/harness-session-send-user-message` — 手动给单个待办发消息（本 skill 的核心原语批量版）
- `/harness-todo-finish` — 结束某条待办；polling 会自动跳过已终态的项
