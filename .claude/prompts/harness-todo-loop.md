# Ralph Loop 提示词：harness 待办项批处理

> 用途：配合 `/ralph-loop` 使用，依次处理 harness 系统中所有 `running` 状态的待办项。
>
> 启动命令（默认执行策略，直接复制到 Claude Code 中运行）：
>
> ```
> /ralph-loop "$(sed -n '/<!-- --- PROMPT START --- -->/,/<!-- --- PROMPT END --- -->/p' .claude/prompts/harness-todo-loop.md)" --max-iterations 5 --completion-promise "待办项执行成功"
> ```
>
> 启动命令（**自定义执行策略**——把"怎么执行"的指令拼接到 prompt 末尾）：
>
> ```
> /ralph-loop "$(sed -n '/<!-- --- PROMPT START --- -->/,/<!-- --- PROMPT END --- -->/p' .claude/prompts/harness-todo-loop.md)
>
> ### 用户自定义执行策略
> 使用 bash 直接跑 npm test；测试通过即视为成功" --max-iterations 5 --completion-promise "待办项执行成功"
> ```
>
> 也可以把下方 `--- PROMPT START ---` 到 `--- PROMPT END ---` 之间的内容整段贴进 `/ralph-loop "<贴这里>"`，若需自定义执行策略再在末尾追加 `### 用户自定义执行策略` 段。

---

<!-- --- PROMPT START --- -->

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

**步骤 3 — 执行待办项（按执行策略分派）**

优先级规则（严格按此顺序判断）：

1. **检查本 prompt 末尾是否存在 `### 用户自定义执行策略` 小节，且该小节下内容非空**
   - 若存在 → **严格按用户自定义执行策略执行**，该段内容即是本步骤的全部执行说明
   - 用户策略里写了什么就照做什么（例如"用 bash 跑 npm test"、"调用某个 skill 处理"、"调用某个 MCP 工具"等），**不要**额外叠加默认策略
2. **若不存在或为空** → 采用默认策略：
   - 把 `title` + `description` 作为任务描述，**以你（当前会话）自身身份直接执行**
   - 按你对该待办项的理解，使用通用工具（Read / Edit / Write / Bash / Grep / Glob / Task 等）完成它；**不要**默认拉起任何特定 skill
   - 需要判断 / 规划 / 调研 / 实现 / 验证时，自主决定边界与粒度；只要最终结果满足待办项描述即算成功

无论哪种策略，都要等执行明确结束后再进入步骤 4，并判定执行是**成功**还是**失败**。

**步骤 4 — 更新状态**
- 执行**成功** → 通过 `.harness/todos.json` 把该 `id` 对应条目的 `status` 从 `running` 改为 `pending`：

  ```bash
  npx tsx -e "
  import { TodoStore } from '<plugin-dir>/src/store.ts';
  const store = new TodoStore(process.argv[1]);
  store.update(process.argv[2], { status: 'pending' });
  " "<cwd>" "<todo-id>"
  ```

  - 其中 `<plugin-dir>` 为本仓库根目录（存在 `src/store.ts` 的目录）
  - `<cwd>` 为当前工作目录
  - 只动 `status` 字段，保留 `tmuxSessionId` / `remoteControlUrl` / `claudeSessionId` 等原值
- 执行**失败** → **不要**改为 `pending`，保持 `running`（或按错误严重程度手动改为 `failed`），并在本轮输出中说明失败原因，交给下一轮重试或人工介入

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
4. **状态单调**：`running → pending` 只在执行成功后发生；失败时绝不改为 `pending`，否则下一轮会误把它视为已处理
5. **终止真实性**：只有在**再次查询列表已无 running 项**时才允许输出 `<promise>`；不得为了逃离循环而撒谎
6. **空列表即完成**：若从一开始就没有 `running` 项（或 `.harness` 不存在），这是合法的终止态，可直接输出 `<promise>待办项执行成功</promise>`
7. **执行策略一致性**：同一次 Ralph Loop 的所有迭代必须使用同一种执行策略（要么一直默认，要么一直用户策略），不得在不同轮次切换

## 异常处理

| 场景 | 处理方式 |
|------|---------|
| 执行策略（默认或自定义）报错中断 | 保持 `running` 或改 `failed`，在本轮输出中记录错误，不输出 `<promise>`，本轮结束 |
| `.harness/todos.json` 损坏 / 格式异常 | **不要**尝试修复（可能吃掉未保存数据），报告并结束本轮 |
| 待办项缺少 `title` / `description` | 把能拿到的字段（至少 `id`）交给执行策略，让其自行询问或查阅上下文 |
| 同一待办项连续多轮失败 | 在本轮日志里明确标注「第 N 轮仍失败」，依赖 `--max-iterations` 兜底终止，避免死循环 |
| 状态写回失败（磁盘 / 权限） | 视同本轮执行失败：不输出 `<promise>`，报错并等待下一轮 |
| 用户自定义执行策略本身不合法 / 无法执行 | 视同失败，保持 `running`，输出错误原因；**不要**静默降级到默认策略 |

<!-- --- PROMPT END --- -->

---

## 使用说明

### 方式 A：一条命令启动（默认执行策略）

在项目根目录下执行：

```
/ralph-loop "$(sed -n '/<!-- --- PROMPT START --- -->/,/<!-- --- PROMPT END --- -->/p' .claude/prompts/harness-todo-loop.md)" --max-iterations 5 --completion-promise "待办项执行成功"
```

### 方式 B：自定义执行策略

把"怎么执行"的指令拼接到 prompt 末尾的 `### 用户自定义执行策略` 小节：

```
/ralph-loop "$(sed -n '/<!-- --- PROMPT START --- -->/,/<!-- --- PROMPT END --- -->/p' .claude/prompts/harness-todo-loop.md)

### 用户自定义执行策略
<在这里写具体怎么执行，例如：
 - 使用 bash 执行 npm run test：<task-description>
 - 直接手动实现，不调用任何 skill
 - 调用 Task 工具派发 subagent 处理
 - 调用 MCP 工具 foo 处理这个 todo
>" --max-iterations 5 --completion-promise "待办项执行成功"
```

### 方式 C：手动复制 prompt

把本文件 `<!-- --- PROMPT START --- -->` 到 `<!-- --- PROMPT END --- -->` 之间的整段内容复制，粘贴到：

```
/ralph-loop "<粘贴到这里>

### 用户自定义执行策略
<可选：写具体策略；不写则走默认>" --max-iterations 5 --completion-promise "待办项执行成功"
```

## 参数说明

| 参数 | 值 | 解释 |
|------|----|----|
| `--max-iterations` | `5` | 最多迭代 5 次。若 `running` 项超过 5 个，建议调大此值（每轮处理 1 项，再加 1–2 轮 buffer） |
| `--completion-promise` | `待办项执行成功` | 完成标识，必须与 prompt 中 `<promise>` 标签内文字**完全一致** |

## 执行策略说明

| 场景 | 表现 |
|------|------|
| 未附加 `### 用户自定义执行策略` 小节 | 默认策略：以当前会话身份直接执行，用通用工具（Read/Edit/Write/Bash/Grep/Glob/Task…）完成；不默认拉起任何 skill |
| 附加了该小节且内容非空 | 严格按小节内文字执行（每轮对每一条 todo 都走这条策略） |
| 附加了该小节但内容为空 / 只有占位符 | 视同未附加，走默认策略 |

> 重要：用户策略一旦附加，不会在迭代中途切换回默认。若写错了，用 `/ralph-loop:cancel-ralph` 取消后重新启动。

## 调参建议

- **待办项较多**：把 `--max-iterations` 调到 `待办项数量 + 2`，给失败重试留空间
- **任务复杂**：单轮可能耗时很长，Ralph 不会在单轮内打断；若希望走一个完整的端到端开发流水线（设计 / 实现 / 验证 / 评审），可用方式 B 把策略显式指定为你想用的 skill 或工具链
- **任务很简单**：保持默认即可（直接按描述做事），不用把每条都过一遍重型 skill
- **启动前检查**：先 `/harness-todo-list` 看一眼至少有一个 `running` 项；否则循环只会空转并以 `max-iterations` 结束

## 避坑

1. `<promise>` 短语必须与 `--completion-promise` 参数**一字不差**（当前为 `待办项执行成功`）
2. 中途想停：执行 `/ralph-loop:cancel-ralph` 或删除 `.claude/ralph-loop.local.md`
3. `.harness/todos.json` 由 harness skills 统一管理，除非清楚 schema，否则不要手动编辑
4. `running → pending` 语义：本流程把 `pending` 视为「Ralph 已完成处理、等待后续人工确认/收尾」的状态；若你的工作流把 `pending` 当作「未开始」，请把步骤 4 的目标状态改为更合适的值（如 `done`）
5. 自定义执行策略尽量写得**可独立执行**：把它当作一句能交给一个陌生助手照做的指令来写，避免依赖"你知道我想说的那个意思"
