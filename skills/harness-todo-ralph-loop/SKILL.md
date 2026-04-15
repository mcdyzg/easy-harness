---
name: harness-todo-ralph-loop
description: "Generate a customized ralph-loop prompt file with user-specified execution strategy, then start the ralph loop to batch-process all `running` todos in `.harness/todos.json`. Use when user wants to batch-process running harness todos with a custom execution strategy, launch a ralph loop over harness todos, or automate running-todo processing. Triggers on phrases like 'ralph loop 跑 running 待办', 'batch process harness todos', 'auto-run running todos', '循环处理待办项', '用 ralph loop 批处理待办'."
---

# Harness Todo Ralph Loop

基于 `.claude/prompts/harness-todo-loop.md` 模板，把用户提供的**每轮执行策略**注入到模板末尾，然后在 `.harness/` 下生成一份独立的 ralph-loop prompt，再调用 `ralph-loop` 插件的 setup 脚本启动循环。第一轮由本 skill 触发 Claude 按新 prompt 开始执行；第二轮起由 ralph-loop 的 stop hook 在每次 end-of-turn 重新注入同一 prompt 让 Claude 继续，直到满足 `<promise>` 或达到 `--max-iterations`。

## 输入

用户消息中应当包含：

- **执行策略**（必填，可多行自然语言）：每一轮对单条 `running` todo 的具体执行办法。例如"用 bash 跑 `npm test`"、"调用 `code-reviewer` skill 处理"、"调用 MCP 工具 `foo` 处理"等
- **max-iterations**（选填）：最大迭代次数。支持 `--max-iterations <n>`、`max-iterations=<n>`、"迭代 N 次"、"N 轮" 等写法

**执行策略缺失时**：**不要**自作主张走默认。停下来向用户追问"这轮循环里每条 todo 具体怎么执行？"再继续。

## 处理流程

### 1. 硬预检（任一不满足即停下报告，不静默修复）

- 模板文件存在：`.claude/prompts/harness-todo-loop.md`
- `.harness/todos.json` 存在，**且至少有一条 `status == "running"`**
  - running 数 = 0 → 拒绝启动，告知"当前无 running 待办，启动循环会空转直到 max-iterations"；不硬往下走
- `.claude/ralph-loop.local.md` 不存在
  - 已存在 → 询问用户"当前已有活跃的 ralph loop（iteration: X），继续会覆盖，是否确认？"；**不默认覆盖**

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

### 5. 抽出模板正文并注入用户执行策略

```bash
TS=$(date +%Y%m%d-%H%M%S)
OUT_FILE=".harness/ralph-loop-${TS}.md"
mkdir -p .harness

# 抽出模板里 PROMPT START / END 之间的正文
sed -n '/<!-- --- PROMPT START --- -->/,/<!-- --- PROMPT END --- -->/p' \
  .claude/prompts/harness-todo-loop.md > "$OUT_FILE"

# 在末尾追加用户自定义执行策略（原文保留换行与原貌）
cat >> "$OUT_FILE" <<'EOF'

### 用户自定义执行策略
EOF
printf '%s\n' "<用户原文>" >> "$OUT_FILE"
```

写完后**读一遍**生成文件校验：必须能看到 `### 用户自定义执行策略` 小节且非空，否则视为预检失败。

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

- 调 `harness-todo-list` 查询 running → 取第一条 → 按注入的「用户自定义执行策略」执行 → 成功改 `pending` → 终止判定
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
- **第一轮归属**：setup 脚本返回后由当前 skill 上下文的 Claude 直接开始工作；第二轮起由 stop hook 接管注入 prompt。用户只需理解"执行策略已经固化在生成的文件末尾"这一件事
- **与 `harness-todo-finish` 的区别**：本 skill 只把 `running` 改成 `pending`（交还给后续人工/其他流程），**不会**改 `done`；若想改 `done`，要么在执行策略里让模型自己调 `harness-todo-finish`，要么直接用 `/harness-todo-finish`

## 错误文案对照

| 场景 | 文案 |
|------|------|
| 模板文件缺失 | `模板文件不存在：.claude/prompts/harness-todo-loop.md，无法生成 prompt` |
| running 数 = 0 | `当前无 running 待办项，启动循环会空转直到 max-iterations——已取消` |
| 已有活跃 loop | `检测到已有活跃 ralph loop（iteration: X / max: Y），继续会覆盖它的状态文件，确认吗？` |
| 插件未安装 | 见「降级分支」 |
| 执行策略缺失 | `本 skill 需要你指定"每条 running todo 怎么执行"（比如：用 bash 跑 npm test）。请补充。` |
| max-iterations > 20 | `你设的 max-iterations=<N> 较大，每轮是独立完整 Claude 回合；确认继续吗？` |
| `.harness/todos.json` 损坏 | `.harness/todos.json 格式异常，不尝试修复（可能吃掉未保存数据），请先人工修复` |
