# Tmux Session Auto-Resume 设计

## 目标

机器重启、tmux server 崩溃或用户误 `tmux kill-session` 等原因导致 harness todo 关联的 tmux 会话丢失后，下一次对该 todo 发送消息时自动恢复会话：优先用 `claude --resume <claudeSessionId>` 接回原对话，使历史上下文不丢失；无法 resume 时退化为全新 spawn。整个恢复过程对调用方透明，不引入新的 user-facing skill。

## 背景

项目现状：

- `.harness/todos.json` 记录了每条 todo 的 `tmuxSessionId`（`harness-<id>`）、`claudeSessionId`（由 `SessionStart` hook 异步回填）、`remoteControlUrl`、`claudeSessionName`、`status`、`title`、`description` 等完整重建材料
- `harness-todo-create` 用 `claude -n '<name>' --remote-control '<prompt>'` 起 tmux 会话
- `harness-session-send-user-message` / `harness-todo-polling` 通过 `tmux send-keys` 把消息投给会话
- tmux 会话一旦丢失，上述两个 skill 的 send-keys 会直接失败；但 `.harness/todos.json` 里 `status: running` 的记录仍然存在，`claudeSessionId` 也还在——Claude Code 本身支持 `claude --resume <session-id>` 接回 JSONL 日志里的对话

所以"恢复"所需的全部信息都在本地，只是缺一条把它们串起来的逻辑。

## 需求边界（已经和用户对齐）

- **触发方式**：C（自动恢复），仅在真正需要活跃 tmux 的操作里触发
- **缺 `claudeSessionId` 时的回退**：A（用原始 `title + description` 全新 spawn，历史对话丢失可接受）
- **覆盖范围**：仅 `harness-session-send-user-message` 和 `harness-todo-polling` 两个 skill
- **不做**的事：
  - 不在 `harness-todo-list` 里扫描并静默恢复
  - 不加 `harness-todo-reopen` 之类的纯手动重开 skill
  - `harness-todo-finish` / `harness-todo-remove` 不触发恢复（tmux 丢了 kill 步骤静默跳过即可，维持当前行为）

## 架构

### 新增模块：`src/services/recovery.ts`

对外暴露一个函数：

```ts
export async function ensureSessionAlive(
  cwd: string,
  todo: TodoItem
): Promise<void>;
```

语义：**返回即代表 `todo.tmuxSessionId` 对应的 tmux 会话现在活着且可被 send-keys**。如果调用前就活着，直接返回；如果挂了，按下述规则尝试恢复；无法恢复则抛错。

### 内部流程

```
ensureSessionAlive(cwd, todo):
  1. tmux has-session -t <todo.tmuxSessionId>
     → 活着：return
  2. todo.status !== 'running'：return
     （语义：非 running 不归恢复负责，让调用方按原有逻辑报错/跳过）
  3. 进入恢复分支：
     - 有 claudeSessionId → 分支 A
     - 没有 claudeSessionId → 分支 B
  4. 起 tmux 会话（见下）
  5. sleep 2s 等 Claude 启动
  6. 再次 has-session 确认，失败则抛错
  7. 写一行日志，return
```

### 分支 A：`claude --resume`

```bash
tmux new-session -d -s <todo.tmuxSessionId> \
  "claude -n '<todo.claudeSessionName>' --resume <todo.claudeSessionId>"
```

- **不带** `--remote-control`：resume 不生成新的 remote control URL
- `remoteControlUrl` 字段保持原值不变（不再试图更新）
- `claudeSessionId` 保持原值不变
- `firstMessageSent` 保持原值不变
- `SessionStart` hook 触发时看到 `todo.claudeSessionId` 已填，按既有逻辑静默跳过（`scripts/on-session-start.sh:47`）

### 分支 B：用原始 title/description 全新 spawn

命令与 `harness-todo-create` 第 3 步保持一致：

```bash
tmux new-session -d -s <todo.tmuxSessionId> \
  "claude -n '<todo.claudeSessionName>' --remote-control '当前任务信息是：
- 标题：<todo.title>
- 描述：<todo.description>'"
```

- 等 Claude 启动后 `tmux capture-pane -t <tmuxSessionId> -p` 抓输出
- 解析 `https://claude.ai/code/session_...` 回写 `remoteControlUrl`
- `claudeSessionId` 留给 `SessionStart` hook 异步回填（此时 todo 的旧字段为空串，hook 的空值判断会触发更新）
- **把 `firstMessageSent` 重置为 `false`**：分支 B 相当于重开任务，`--remote-control` 里的 prompt 是新会话的首消息，polling 下一轮应把它当作"首次唤醒"对待

### Resume 失败的退化

如果分支 A 的 `new-session` 成功但 Claude 本身因 JSONL 已被清理等原因启动即退出（步骤 6 的二次 `has-session` 失败），视为 resume 不可用，**退化到分支 B 再跑一遍**；分支 B 再失败才真的抛错。

### 调用点

两处，都在"即将 send-keys"之前：

1. `src/services/message.ts`（或等效位置）里发送用户消息的函数顶端
2. `src/scripts/polling.ts`（或 `src/services/polling.ts`）里 trigger 下一个 todo 的分支顶端

两处都复用同一个 `ensureSessionAlive`。

### 并发保护

不加显式锁。利用 `tmux new-session -d -s <name>` 在目标 session 已存在时会报错的特性做天然互斥：

- 场景：polling 和 send-message 同时发现挂掉，并行调用 `ensureSessionAlive`
- 谁先跑到 `tmux new-session` 谁拿到启动权
- 另一个会在 `new-session` 失败；此时再做一次 `has-session` 检查，如果已存在就视为恢复成功继续；依然不存在才真报错

实现上把 "new-session 失败后二次 has-session" 作为正常分支，不做特殊 retry。

### 日志

恢复动作追加一行到 `<plugin-dir>/log/recovery.log`：

```
2026-04-22T10:30:12.345Z todo=<id> branch=A result=ok
2026-04-22T10:31:05.120Z todo=<id> branch=B result=ok (fallback from A: resume-failed)
```

只用 `fs.appendFileSync`，不引入日志库。

## 记录字段变更矩阵

| 字段 | 分支 A | 分支 B |
|------|--------|--------|
| `tmuxSessionId` | 不变 | 不变 |
| `claudeSessionId` | 不变 | 暂为空串，`SessionStart` hook 异步回填 |
| `claudeSessionName` | 不变 | 不变 |
| `remoteControlUrl` | 不变 | 重抓并更新 |
| `firstMessageSent` | 不变 | 重置为 `false` |
| `status` | 不变（保持 `running`） | 不变（保持 `running`） |

## 边缘情况

- **`status === 'pending'`**：不应该出现（`pending` 意味着 Claude 在线空闲，tmux 必然还活着）；万一真的出现，按 `status !== 'running'` 规则直接 return，让调用方报错
- **`status === 'done'` / `'failed'`**：同上，不恢复
- **记录里字段是空串 vs 缺失**：`TodoStore.get` 返回的对象从创建时起所有字段就被写成空串而非 undefined，用 `!todo.claudeSessionId` 作为"缺失"的判断即可
- **分支 B 时 `claudeSessionName` 也为空**：理论上创建流程第 4 步会写入，若真为空则生成默认 `[HARNESS_SESSION]<title>`（兜底）
- **tmux 自身不可用**：直接让 `execSync` 抛错，由调用方捕获并提示用户检查 tmux 环境，不归恢复模块处理

## 不在本设计范围

- 不做 tmux 会话健康的前台监控 / 心跳
- 不改造 `/harness-todo-list` 的展示（用户明确不要）
- 不引入 `harness-todo-reopen` skill
- 不处理"同一 claude session id 被两个 tmux 并发 resume"这种跨进程冲突——`claudeSessionId` 是每个 todo 唯一绑定的，跨 todo 不会碰撞

## 风险清单（留给实现阶段验证，不阻塞设计定稿）

1. `claude --resume <id>` 在非交互参数形式下的确切行为：如果遇到交互 picker，需要确认 `<id>` 参数会直接接入而非弹选项；已知该用法在当前 Claude Code 版本可用（用户确认）
2. `--resume` 后新老会话的 `session_id` 是否一致：按用户定调「不带 `--remote-control` 不需要重抓 URL」，设计上假定 resume 保留原 session_id；若后续版本行为变化，再独立处理
3. `sleep 2` 是否足够：实现时可根据实测调小/加固（比如改成 `capture-pane` 轮询看到 Claude banner），不影响当前设计契约

## 测试要点

单元测试（`tests/` 目录）：

- `ensureSessionAlive`：桩掉 `tmux` 命令，覆盖 4 条路径
  - tmux 已存在 → no-op
  - status 非 running → 直接 return
  - 有 claudeSessionId → 走分支 A，sessionName 正确
  - 无 claudeSessionId → 走分支 B，prompt 正确、`firstMessageSent` 被重置

集成测试（可选，本地手动）：

- 起一个 harness todo，`tmux kill-session`，然后 `/harness-session-send-user-message`，验证 tmux 自动起来、Claude 历史对话可见、消息被接收
- 清掉 `claudeSessionId` 字段再 kill-session，重复上面流程，验证走分支 B 且原始 task 描述被重新投递
