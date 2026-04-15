---
name: harness-todo-ralph-loop
description: "Generate a customized ralph-loop prompt file with user-specified execution strategy, then start the ralph loop to batch-process all `running` todos in `.harness/todos.json`. Use when user wants to batch-process running harness todos with a custom execution strategy, launch a ralph loop over harness todos, or automate running-todo processing. Triggers on phrases like 'ralph loop 跑 running 待办', 'batch process harness todos', 'auto-run running todos', '循环处理待办项', '用 ralph loop 批处理待办'."
---

# Harness Todo Ralph Loop

把下方【内联 PROMPT 模板】与用户提供的**用户命令**（每轮下发给 running todo 关联 Claude 会话的消息原文）拼接，在 `.harness/` 下生成一份独立的 ralph-loop prompt，再调用 `ralph-loop` 插件的 setup 脚本启动循环。每一轮 ralph loop 会话会调用 `harness-session-send-user-message` skill 把这段用户命令发给当前 running todo 关联的 Claude 会话，由该会话自行完成业务动作。第一轮由本 skill 触发 Claude 按新 prompt 开始执行；第二轮起由 ralph-loop 的 stop hook 在每次 end-of-turn 重新注入同一 prompt 让 Claude 继续，直到满足 `<promise>` 或达到 `--max-iterations`。

> 设计要点：模板内容**内联**在本 SKILL.md 的第 5 步里，不依赖仓库中任何外部文件。skill 被安装到任何项目后都能独立工作。

## 输入

用户消息中应当包含：

- **用户命令**（必填，可多行自然语言）：每一轮调度到单条 `running` todo 时，要**通过 `harness-session-send-user-message` skill 发给其关联 Claude 会话**的消息原文。这是从 ralph loop 会话发给 todo 关联会话的"用户指令"，由该会话自行解读并执行——例如"继续完成当前任务"、"跑一下 npm test 并修复失败用例"、"按之前的方案补完剩余代码"等
- **max-iterations**（选填）：最大迭代次数。支持 `--max-iterations <n>`、`max-iterations=<n>`、"迭代 N 次"、"N 轮" 等写法

**用户命令缺失时**：**不要**自作主张生成默认文案。停下来向用户追问"要发给每条 running todo 关联会话的用户命令是什么？"再继续。

## 处理流程

### 1. 硬预检（任一不满足即停下报告，不静默修复）

- `.harness/todos.json` 存在，**且至少有一条 `status == "running"`**
  - running 数 = 0 → 拒绝启动，告知"当前无 running 待办，启动循环会空转直到 max-iterations"；不硬往下走
- `.claude/ralph-loop.local.md` 不存在
  - 已存在 → 询问用户"当前已有活跃的 ralph loop（iteration: X），继续会覆盖，是否确认？"；**不默认覆盖**

> 注：模板正文已内联在本 skill 第 5 步，**不再需要**检查 `.claude/prompts/harness-todo-loop.md` 是否存在。

```bash
# running 计数
npx tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
const store = new TodoStore(process.argv[1]);
console.log(store.list().filter(t => t.status === 'running').length);
" "<cwd>"
```

### 2. 定位 ralph-loop 插件 setup 脚本

```bash
RALPH_SCRIPT=$(ls ~/.claude/plugins/marketplaces/*/plugins/ralph-loop/scripts/setup-ralph-loop.sh 2>/dev/null | head -1)
if [ -z "$RALPH_SCRIPT" ]; then
  RALPH_SCRIPT=$(ls ~/.claude/plugins/cache/*/ralph-loop/*/scripts/setup-ralph-loop.sh 2>/dev/null | sort -V | tail -1)
fi
```

定位失败 → 跳到文末「降级分支」，不要自己复刻 stop hook。

### 3. 确定 max-iterations

优先级（严格按序）：

1. 用户显式传入 → 直接使用
2. 未传入 → 读 running 计数，默认 = `max(running_count + 2, 3)`，**封顶 20**
3. 用户传入 > 20 → **不阻拦**，但向用户警告"每轮是独立完整 Claude 回合，请确认额度"，得到确认再继续

```bash
if [ -z "$USER_MAX_ITER" ]; then
  MAX_ITER=$(( RUNNING_COUNT + 2 ))
  [ $MAX_ITER -lt 3 ] && MAX_ITER=3
  [ $MAX_ITER -gt 20 ] && MAX_ITER=20
else
  MAX_ITER="$USER_MAX_ITER"
fi
```

### 4. 超量 running 告警（软失败：警告后让用户决定）

`RUNNING_COUNT > 10` 时：

> 当前 running 待办 N 条，每条 × 每轮 ≈ 一次完整 Claude 回合，可能很耗配额。建议分批跑或确认继续？

得到确认再进入第 5 步。

### 5. 用 Write 工具生成 prompt 文件（模板内联，不依赖外部文件）

先用 Bash 确定时间戳与目录：

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p .harness
echo ".harness/ralph-loop-${TS}.md"
```

然后**直接用 Write 工具**把下方【PROMPT 模板正文】原样写入 `.harness/ralph-loop-<TS>.md`，并在末尾追加 `### 用户命令` 小节 + 用户原文。

**拼接规则**：

1. `part-A`：【PROMPT 模板正文】的全文，原样复制（Markdown 标题/代码块都保留，不要加省略号，不要改动 `<plugin-dir>` 占位符——它由执行期的 Claude 自行解析成实际插件目录）
2. 一个空行
3. `part-B`：

   ```
   ### 用户命令
   <用户原文，保留换行与原貌>
   ```

写完后用 Read 工具重读生成文件校验：
- 文件以 `### 用户命令` 小节结尾且内容非空
- 模板正文里的 `# 任务：批处理 harness 中所有 running 状态的待办项` 标题存在
- 否则视为预检失败，报告后中止；**不要**尝试"修一下再继续"

---

#### 【PROMPT 模板正文】（写入 part-A 的唯一权威来源）

> 下面以 `===BEGIN PROMPT TEMPLATE===` 和 `===END PROMPT TEMPLATE===` 之间的内容为准，两行标记本身**不**写入输出文件。外层用 4 反引号围栏以容纳模板内部的 3 反引号 `bash` 代码块。

````
===BEGIN PROMPT TEMPLATE===
# 任务：批处理 harness 中所有 running 状态的待办项

## 目标

把 harness 系统中所有 `running` 状态的待办项逐个执行完毕，执行成功后把状态改为 `pending`，直至列表中不再存在 `running` 项。

## 每轮迭代标准流程

**步骤 1 — 查询当前状态**
- 调用 `harness-todo-list` skill 读取 `.harness/todos.json`
- 筛出列表中所有 `status == "running"` 的待办项
- 如果文件不存在或 `running` 列表为空 → 跳到「终止判定」

**步骤 2 — 选取一个待办项**
- 从 `running` 列表中取**第一条**（按 `store.list()` 返回顺序）
- 记下其 `id`，后续所有定位都用 `id`（不用序号，序号会变）
- 同时读取其 `title` / `description` 作为任务上下文

**步骤 3 — 执行待办项（通过 `harness-session-send-user-message` skill 下发用户命令）**

本步骤的"执行"定义为：把**用户命令**发送到该待办项关联的 Claude Code 会话，由该会话自行解读并完成具体业务动作。ralph loop 当前会话**不直接在本会话内执行业务逻辑**（避免污染上下文，并让每条 todo 的产出留在自己会话的日志中）。

1. **读取用户命令**
   - 定位本 prompt 末尾的 `### 用户命令` 小节
   - 若该小节不存在或内容为空 → 视为执行失败（见步骤 4 的失败分支），在本轮输出中明确报错："当前 ralph loop 缺失用户命令，无法下发"，跳到步骤 5
2. **调用 `harness-session-send-user-message` skill**
   - **待办项标识**：使用当前待办项的完整 `id`（不要使用序号、title，避免歧义）
   - **消息内容**：上一步读到的用户命令**原文**，保留换行与原貌；**不要**在消息里叠加额外说明、上下文、或 ralph loop 自身的元信息
   - 必要时可参考 `harness-session-send-user-message` 的入参要求做最小包装，但不得篡改用户原文语义
3. **判定发送结果**
   - skill 返回"消息已通过 tmux send-keys 送达" → 视为**执行成功**（注意：业务完成与否由关联会话自行处理，ralph loop 只对"消息送达"负责）
   - skill 报错（目标 todo 非 running / `tmuxSessionId` 为空 / tmux 会话丢失且用户拒绝恢复 / tmux 命令报错 / 其它异常）→ 视为**执行失败**，把 skill 返回的错误原文写入本轮输出
4. **不要等待业务完成**
   - 发送成功后立即进入步骤 4，**不要**在本轮 sleep / 轮询 `todos.json` 等待关联会话产出结果
   - 业务侧的成功/失败由关联会话自己负责，它完成后会自行改状态或由 `harness-todo-finish` 等 skill 介入

**步骤 4 — 更新状态**

这里的"成功/失败"仅指**消息是否已通过 `harness-session-send-user-message` skill 成功送达**，不代表业务执行结果。

- 消息**送达成功** → 通过 `.harness/todos.json` 把该 `id` 对应条目的 `status` 从 `running` 改为 `pending`：

  ```bash
  npx tsx -e "
  import { TodoStore } from '<plugin-dir>/src/store.ts';
  const store = new TodoStore(process.argv[1]);
  store.update(process.argv[2], { status: 'pending' });
  " "<cwd>" "<todo-id>"
  ```

  - 其中 `<plugin-dir>` 为 easy-harness 插件的实际安装目录（存在 `src/store.ts` 的目录，例如 `~/.claude/plugins/cache/easy-harness-marketplace/easy-harness/<version>`）
  - `<cwd>` 为当前工作目录
  - 只动 `status` 字段，保留 `tmuxSessionId` / `remoteControlUrl` / `claudeSessionId` 等原值
  - 这里把 `running → pending` 的语义理解为"已从 ralph loop 分派给关联会话"；后续业务侧的完成/失败由关联会话自行改 `done`/`failed`（或人工介入）
- 消息**送达失败** → **不要**改为 `pending`，保持 `running`（若 skill 已将其标记为 `failed` 则保留其 `failed`），并在本轮输出中说明失败原因，交给下一轮重试或人工介入

**步骤 5 — 终止判定**
- 再次调用 `harness-todo-list`（**不要**复用步骤 1 的快照，可能已被外部修改）
- 若**已无 `status == "running"` 的待办项** → 目标达成，输出：

  ```
  <promise>待办项执行成功</promise>
  ```

- 否则 → 本轮结束，等待下一次 Ralph 迭代自然拉起

## 严格约束

1. **单轮只处理一条**：每轮只完整处理一个 `running` 待办项，避免一次吞太多状态变动
2. **每轮重读**：每轮都从 `.harness/todos.json` 重新读，禁止缓存上一轮的内存列表
3. **id 优先**：所有定位使用 `id`，禁止使用会变动的序号（#）
4. **状态单调**：`running → pending` 只在**消息成功送达**后发生；送达失败时绝不改为 `pending`，否则下一轮会误把它视为已处理
5. **终止真实性**：只有在**再次查询列表已无 running 项**时才允许输出 `<promise>`；不得为了逃离循环而撒谎
6. **空列表即完成**：若从一开始就没有 `running` 项（或 `.harness` 不存在），这是合法的终止态，可直接输出 `<promise>待办项执行成功</promise>`
7. **执行通道一致性**：同一次 Ralph Loop 的所有迭代必须走 `harness-session-send-user-message` 下发用户命令，不得在不同轮次切换到"本会话直接执行"等其它通道
8. **消息原文不改写**：下发给关联会话的消息必须是 `### 用户命令` 小节的原文，不得在前后包裹 ralph loop 的元信息 / 解释 / 进度摘要

## 异常处理

| 场景 | 处理方式 |
|------|---------|
| `harness-session-send-user-message` 返回错误（非 running / tmuxSessionId 为空 / tmux 报错等） | 保持 `running`（若 skill 自身已改 `failed` 则保留 `failed`），在本轮输出中记录错误，不输出 `<promise>`，本轮结束 |
| tmux 会话丢失且用户拒绝恢复 | skill 会把 `status` 标为 `failed`；ralph loop 本轮不再尝试改 `pending`，记录并结束本轮 |
| `### 用户命令` 小节缺失或为空 | 视同失败，保持 `running`，输出"当前 ralph loop 缺失用户命令，无法下发"；**不要**自造一条默认消息 |
| `.harness/todos.json` 损坏 / 格式异常 | **不要**尝试修复（可能吃掉未保存数据），报告并结束本轮 |
| 待办项缺少 `title` / `description` | 只要 `id` 和 `tmuxSessionId` 在，消息仍可下发；title/description 只是辅助信息 |
| 同一待办项连续多轮失败 | 在本轮日志里明确标注「第 N 轮仍失败」，依赖 `--max-iterations` 兜底终止，避免死循环 |
| 状态写回失败（磁盘 / 权限） | 视同本轮执行失败：不输出 `<promise>`，报错并等待下一轮 |
===END PROMPT TEMPLATE===
````

### 6. 输出启动摘要（给用户看的反馈）

在调用 setup 脚本之前先打一行摘要，便于用户在 Claude 工具返回里一眼看懂：

```
Ralph Loop 已启动
├─ 生成文件：.harness/ralph-loop-<TS>.md
├─ running 待办数：<N>
├─ max-iterations：<M>
└─ 紧急中止：/ralph-loop:cancel-ralph  或  rm .claude/ralph-loop.local.md
```

### 7. 调用 setup 脚本启动循环

```bash
bash "$RALPH_SCRIPT" "$(cat "$OUT_FILE")" \
  --max-iterations "$MAX_ITER" \
  --completion-promise "待办项执行成功"
```

脚本会：
- 写入 `.claude/ralph-loop.local.md` 状态文件（stop hook 据此拦截退出）
- 把完整 prompt 回显到 stdout
- 附带 CRITICAL promise 规则说明

### 8. 进入第一轮

setup 脚本返回后，当前会话继续按 stdout 回显出的 prompt 内容开始**第一轮**：

- 调 `harness-todo-list` 查询 running → 取第一条 → 调用 `harness-session-send-user-message` skill，把注入的「用户命令」原文发给该 todo 关联会话 → 送达成功改 `pending` → 终止判定
- 后续迭代由 stop hook 在 end-of-turn 时重新注入同一 prompt 让 Claude 继续，**本 skill 不再介入**

---

## Usage Limit / 配额边界

ralph loop 是长循环，必须正面处理超限场景：

| 情形 | 表现 | 处理 |
|------|------|------|
| **会话级 usage limit**（窗口耗尽） | 某轮跑一半整个 session 挂起 | `.claude/ralph-loop.local.md` 仍在；恢复后 stop hook **不会主动续跑**（只在 end-of-turn 触发）。用户需手动继续：贴 `$(cat .harness/ralph-loop-<TS>.md)` 作为新 prompt；或 `rm .claude/ralph-loop.local.md` + 重新调用本 skill |
| **单回合 token cap** | 某条 todo 过复杂，一轮内输出写满被硬截 | 那轮没走到 `running → pending`，下轮自动重做同一条——幂等保证不会误标完成。若**连续 2 轮仍失败于同一 id** → 在本轮输出显式打出"第 N 轮仍失败于 id=xxx，疑似超单回合 cap，考虑拆分 todo / 换策略"，依赖 `--max-iterations` 兜底截停 |
| **启动时已接近超限** | 第一轮立刻挂 | setup 步骤原子，要么状态文件写成功、要么没写；留下孤儿状态文件时一键 `/ralph-loop:cancel-ralph` 清理 |

### 为什么这样设计是安全的

- **幂等**：`running → pending` 只在"执行成功"后发生；截断/挂起时状态保持 `running`，下轮重试不会误标完成
- **可清理**：所有副产物固定路径（`.harness/ralph-loop-<TS>.md`、`.claude/ralph-loop.local.md`），用户随时可删
- **有兜底**：`--max-iterations` 默认封顶 20，即使死循环也一定自然停下
- **无静默降级**：找不到插件 / running=0 / 已有活跃 loop → 统统停下报告，不猜

---

## 降级分支：ralph-loop 插件缺失

第 2 步定位失败时 **不要**尝试自己复刻 stop hook，改为：

1. 已生成 `.harness/ralph-loop-<TS>.md` 仍保留（它本身就是完整可用的 prompt 文件）
2. 向用户输出：

```
未找到 ralph-loop 插件（~/.claude/plugins 下未命中）。
已为你生成 prompt 文件：.harness/ralph-loop-<TS>.md

请手动执行：

/ralph-loop "$(cat .harness/ralph-loop-<TS>.md)" --max-iterations <M> --completion-promise "待办项执行成功"

若需安装 ralph-loop 插件：/plugin add ralph-loop
```

3. 结束，不再执行后续步骤

---

## 注意事项

- **不要在循环中途修改 `.harness/ralph-loop-<TS>.md`**：会让下一轮 hook 注入的 prompt 与第一轮的 prompt 不一致，违反 ralph "same prompt" 假设
- **`.harness/ralph-loop-*.md` 是 artifact**：可审计、可复用；不进 git 是用户习惯，可在 `.gitignore` 加 `.harness/ralph-loop-*.md`（不强制）
- **第一轮归属**：setup 脚本返回后由当前 skill 上下文的 Claude 直接开始工作；第二轮起由 stop hook 接管注入 prompt。用户只需理解"要下发的用户命令已经固化在生成的文件末尾 `### 用户命令` 小节，每轮都原样发给当前 running todo 关联会话"这一件事
- **与 `harness-todo-finish` 的区别**：本 skill 只把 `running` 改成 `pending`（表示"已下发给关联会话"，后续交由该会话或人工处理），**不会**改 `done`；若想改 `done`，要么在用户命令里明确让关联会话完成后自行调 `harness-todo-finish`，要么在外部直接用 `/harness-todo-finish`

## 错误文案对照

| 场景 | 文案 |
|------|------|
| 生成文件校验失败 | `生成的 .harness/ralph-loop-<TS>.md 缺少 \`### 用户命令\` 小节或正文头，判定为写入异常——已中止，请重试` |
| running 数 = 0 | `当前无 running 待办项，启动循环会空转直到 max-iterations——已取消` |
| 已有活跃 loop | `检测到已有活跃 ralph loop（iteration: X / max: Y），继续会覆盖它的状态文件，确认吗？` |
| 插件未安装 | 见「降级分支」 |
| 用户命令缺失 | `本 skill 需要你给出"要发给每条 running todo 关联会话的用户命令"（比如：继续完成当前任务 / 跑一下 npm test）。请补充。` |
| max-iterations > 20 | `你设的 max-iterations=<N> 较大，每轮是独立完整 Claude 回合；确认继续吗？` |
| `.harness/todos.json` 损坏 | `.harness/todos.json 格式异常，不尝试修复（可能吃掉未保存数据），请先人工修复` |
