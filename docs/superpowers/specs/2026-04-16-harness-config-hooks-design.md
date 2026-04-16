# Harness Config Hooks Design

将 skill 扩展机制从 `harness-custom-*` skill 发现改为 `.harness/config.json` 配置文件声明。

## 背景

当前 easy-harness 在 3 个核心 skill 中预留了 `harness-custom-*` 扩展钩子（`harness-custom-todo-create`、`harness-custom-todo-finish`、`harness-custom-notice-user`）。发现机制是运行时检查当前会话的"可用 skills 列表"中是否含同名 skill。用户需要安装一个独立的 Claude Code skill 来提供扩展，耦合在 skill 系统里。

本次改造将扩展机制迁移到项目级配置文件 `.harness/config.json`，支持 shell command 和 skill 两种 hook 类型。

## 配置文件

### 位置

`<cwd>/.harness/config.json`（与 `todos.json` 同级）

### 格式

```json
{
  "hooks": {
    "todo-create": [
      {
        "type": "command",
        "command": "curl -X POST https://example.com/api/tasks -d @-"
      }
    ],
    "todo-finish": [
      {
        "type": "skill",
        "skill": "my-custom-finish-hook"
      }
    ],
    "notice-user": [
      {
        "type": "command",
        "command": "python3 ./scripts/send-feishu.py"
      },
      {
        "type": "skill",
        "skill": "claude-to-im:send"
      }
    ]
  }
}
```

### 约定

- 顶层 `hooks` 字段，key 是事件名，value 是 hook 数组
- 3 个事件名：`todo-create`、`todo-finish`、`notice-user`
- `type: "command"` → 必须有 `command` 字段
- `type: "skill"` → 必须有 `skill` 字段（skill 名称）
- 配置文件不存在或对应事件无配置 → 静默跳过

## 公共 hook 执行器

新增 `src/services/hooks.ts`，封装"读配置 → 找事件 → 顺序执行"的逻辑。

### 接口

```typescript
interface CommandHook {
  type: "command";
  command: string;
}

interface SkillHook {
  type: "skill";
  skill: string;
}

type HookConfig = CommandHook | SkillHook;

interface HarnessConfig {
  hooks?: Record<string, HookConfig[]>;
}

/**
 * 读取 .harness/config.json，顺序执行指定事件的所有 hook
 * @param baseDir - cwd，用于定位 .harness/config.json
 * @param event - 事件名，如 "todo-create"
 * @param payload - 传给 hook 的 JSON 对象
 */
export async function runHooks(
  baseDir: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void>;
```

### 执行逻辑

1. 读 `<baseDir>/.harness/config.json`，文件不存在 → 静默返回
2. 取 `config.hooks[event]`，不存在或空数组 → 静默返回
3. 遍历数组，逐个执行：
   - `type: "command"` → `child_process.execSync(command, { input: JSON.stringify(payload) })`，捕获异常打印 stderr 后继续
   - `type: "skill"` → `child_process.execSync("claude -p '调用 <skill> skill，参数：<JSON payload>'")`，捕获异常打印 stderr 后继续
4. 单个 hook 失败不阻断后续 hook

### SKILL.md 中的调用方式

```bash
npx --yes tsx -e "
import { runHooks } from '<plugin-dir>/src/services/hooks.ts';
await runHooks(process.argv[1], 'todo-create', JSON.parse(process.argv[2]));
" "<cwd>" '<payload JSON>'
```

## 事件 Payload 定义

### `todo-create`

| 字段 | 说明 |
|------|------|
| `cwd` | 工作目录 |
| `id` | 待办项 ID |
| `title` | 简短标题 |
| `description` | 用户原始描述 |
| `status` | 固定 `running` |
| `tmuxSessionId` | `harness-<id>` |
| `remoteControlUrl` | remote-control URL |
| `claudeSessionId` | session ID（可能为空） |
| `claudeSessionName` | `[HARNESS_SESSION]<title>` |

### `todo-finish`

字段同 `todo-create`，但 `status` 为最终态（`done` 或 `failed`）。

### `notice-user`

| 字段 | 说明 |
|------|------|
| `title` | 待办项标题 |
| `status` | `pending / running / done / failed` |
| `summary` | 生成的中文摘要 |
| `tmuxSessionId` | tmux 会话 ID |
| `remoteControlUrl` | 远程控制链接 |

## 各 skill 的扩展语义

### `todo-create` 和 `todo-finish`

默认流程全部走完后，无条件调用 `runHooks`。hooks 是追加增强，不影响已完成的核心操作。

### `notice-user`

保留 4a/4b 分支逻辑：

- **4a**：SKILL.md 先读 `.harness/config.json` 检查 `notice-user` 事件是否有 hook 配置。有 → 调用 `runHooks` 执行配置的 hooks，**跳过**默认控制台输出（4b）
- **4b**：无配置 → 走默认控制台输出

分支判断不依赖 `runHooks` 返回值，由 SKILL.md 独立读 config 判断。

## 改动清单

### 新增

- `src/services/hooks.ts` — 公共 hook 执行器

### 修改（SKILL.md）

- `skills/harness-todo-create/SKILL.md` — 步骤 5：从"检查 skill 列表中是否有 `harness-custom-todo-create`"改为调用 `runHooks(cwd, 'todo-create', payload)`
- `skills/harness-todo-finish/SKILL.md` — 步骤 7：从"检查 skill 列表中是否有 `harness-custom-todo-finish`"改为调用 `runHooks(cwd, 'todo-finish', payload)`
- `skills/harness-notice-user/SKILL.md` — 步骤 4a：从"检查 skill 列表中是否有 `harness-custom-notice-user`"改为读 config 判断 + 调用 `runHooks(cwd, 'notice-user', payload)`

### 修改（文档）

- `README.md` — Customization 章节：删掉 `harness-custom-*` 全部说明，改写为 `.harness/config.json` hooks 配置说明

### 不动

- `hooks/hooks.json` — 插件系统 hook，不迁移
- `src/types.ts`、`src/store.ts` — 无需改动
- 其他 skill（`harness-todo-list`、`harness-todo-remove`、`harness-session-send-user-message`、`harness-todo-polling`）— 无扩展钩子，不动
