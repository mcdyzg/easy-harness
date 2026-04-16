# Harness Config Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `harness-custom-*` skill discovery mechanism with a `.harness/config.json` hook configuration system, using a shared hook executor in `src/services/hooks.ts`.

**Architecture:** New `src/services/hooks.ts` module reads `.harness/config.json`, finds hooks for a given event name, and executes them sequentially (command via `child_process.execSync` with stdin JSON, skill via `claude -p`). Three SKILL.md files replace their "check skill list for `harness-custom-*`" steps with a one-liner call to this executor. README Customization section rewritten.

**Tech Stack:** TypeScript, Node.js `child_process`, vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/services/hooks.ts` | Create | 读 `.harness/config.json`，顺序执行指定事件的 hooks |
| `tests/services/hooks.test.ts` | Create | hooks 执行器的单元测试 |
| `skills/harness-todo-create/SKILL.md` | Modify | 步骤 5 改为调用 `runHooks` |
| `skills/harness-todo-finish/SKILL.md` | Modify | 步骤 7 改为调用 `runHooks` |
| `skills/harness-notice-user/SKILL.md` | Modify | 步骤 4a 改为读 config + 调用 `runHooks` |
| `README.md` | Modify | Customization 章节重写 |

---

### Task 1: `src/services/hooks.ts` — 写测试

**Files:**
- Create: `tests/services/hooks.test.ts`

- [ ] **Step 1: 创建测试文件，覆盖核心场景**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runHooks } from "../../src/services/hooks.js";
import * as child_process from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("runHooks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-hooks-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeConfig = (config: unknown) => {
    const dir = path.join(tmpDir, ".harness");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config));
  };

  it("config.json 不存在时静默返回", async () => {
    await runHooks(tmpDir, "todo-create", { id: "1" });
    expect(child_process.execSync).not.toHaveBeenCalled();
  });

  it("事件无配置时静默返回", async () => {
    writeConfig({ hooks: {} });
    await runHooks(tmpDir, "todo-create", { id: "1" });
    expect(child_process.execSync).not.toHaveBeenCalled();
  });

  it("事件配置为空数组时静默返回", async () => {
    writeConfig({ hooks: { "todo-create": [] } });
    await runHooks(tmpDir, "todo-create", { id: "1" });
    expect(child_process.execSync).not.toHaveBeenCalled();
  });

  it("执行 type=command 的 hook，通过 stdin 传入 payload JSON", async () => {
    writeConfig({
      hooks: {
        "todo-create": [{ type: "command", command: "cat" }],
      },
    });
    const payload = { id: "abc", title: "test" };
    await runHooks(tmpDir, "todo-create", payload);
    expect(child_process.execSync).toHaveBeenCalledWith("cat", {
      input: JSON.stringify(payload),
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("执行 type=skill 的 hook，通过 claude -p 调用", async () => {
    writeConfig({
      hooks: {
        "todo-finish": [{ type: "skill", skill: "my-finish-hook" }],
      },
    });
    const payload = { id: "abc", status: "done" };
    await runHooks(tmpDir, "todo-finish", payload);
    const call = (child_process.execSync as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("claude");
    expect(call[0]).toContain("my-finish-hook");
  });

  it("顺序执行多个 hook", async () => {
    writeConfig({
      hooks: {
        "notice-user": [
          { type: "command", command: "echo hook1" },
          { type: "command", command: "echo hook2" },
        ],
      },
    });
    await runHooks(tmpDir, "notice-user", { title: "t" });
    expect(child_process.execSync).toHaveBeenCalledTimes(2);
  });

  it("单个 hook 失败不阻断后续", async () => {
    writeConfig({
      hooks: {
        "todo-create": [
          { type: "command", command: "failing-cmd" },
          { type: "command", command: "echo ok" },
        ],
      },
    });
    (child_process.execSync as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => { throw new Error("fail"); })
      .mockImplementationOnce(() => "ok");

    await runHooks(tmpDir, "todo-create", { id: "1" });
    expect(child_process.execSync).toHaveBeenCalledTimes(2);
  });

  it("hooks 字段缺失时静默返回", async () => {
    writeConfig({});
    await runHooks(tmpDir, "todo-create", { id: "1" });
    expect(child_process.execSync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认全部失败**

Run: `cd /Users/bytedance/haha/x/agent/claude-about/easy-harness && npx vitest run tests/services/hooks.test.ts`
Expected: FAIL — `runHooks` 不存在

---

### Task 2: `src/services/hooks.ts` — 实现

**Files:**
- Create: `src/services/hooks.ts`

- [ ] **Step 3: 实现 hooks 执行器**

```typescript
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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
 */
export async function runHooks(
  baseDir: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const configPath = path.join(baseDir, ".harness", "config.json");
  if (!fs.existsSync(configPath)) return;

  let config: HarnessConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return;
  }

  const hooks = config.hooks?.[event];
  if (!hooks || hooks.length === 0) return;

  const payloadJson = JSON.stringify(payload);

  for (const hook of hooks) {
    try {
      if (hook.type === "command") {
        execSync(hook.command, {
          input: payloadJson,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } else if (hook.type === "skill") {
        const escaped = payloadJson.replace(/'/g, "'\\''");
        execSync(`claude -p '调用 ${hook.skill} skill，参数：${escaped}'`, {
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[harness-hooks] ${event} hook 执行失败: ${msg}`);
    }
  }
}
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `cd /Users/bytedance/haha/x/agent/claude-about/easy-harness && npx vitest run tests/services/hooks.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/bytedance/haha/x/agent/claude-about/easy-harness
git add src/services/hooks.ts tests/services/hooks.test.ts
git commit -m "feat: add hook executor for .harness/config.json"
```

---

### Task 3: 修改 `harness-todo-create/SKILL.md`

**Files:**
- Modify: `skills/harness-todo-create/SKILL.md`

- [ ] **Step 6: 替换步骤 5**

将现有的步骤 5（第 79-87 行）整段替换为：

```markdown
### 5. 触发扩展钩子（可选）

**不影响上述默认流程**。上面步骤 2–4 全部完成后，再额外执行 `.harness/config.json` 中 `todo-create` 事件配置的 hooks。

先重新读取记录（`TodoStore.get(id)`）拿到当前快照——由于 `claudeSessionId` 由 SessionStart hook 异步回填，直接用步骤 4 的入参可能拿到空字符串；读一次记录可以尽量拿到最新值。

```bash
npx --yes tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
import { runHooks } from '<plugin-dir>/src/services/hooks.ts';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (todo) {
  await runHooks(process.argv[1], 'todo-create', { cwd: process.argv[1], ...todo });
}
" "<cwd>" "<id>"
```

若 `.harness/config.json` 不存在或 `todo-create` 事件无配置，静默跳过，不影响默认流程。
```

- [ ] **Step 7: 提交**

```bash
cd /Users/bytedance/haha/x/agent/claude-about/easy-harness
git add skills/harness-todo-create/SKILL.md
git commit -m "refactor: harness-todo-create use config.json hooks instead of custom-* skill"
```

---

### Task 4: 修改 `harness-todo-finish/SKILL.md`

**Files:**
- Modify: `skills/harness-todo-finish/SKILL.md`

- [ ] **Step 8: 替换步骤 7**

将现有的步骤 7（第 117-124 行）整段替换为：

```markdown
### 7. 触发扩展钩子（可选）

**不影响上述默认流程**。步骤 4–6 全部完成后，再额外执行 `.harness/config.json` 中 `todo-finish` 事件配置的 hooks。

```bash
npx --yes tsx -e "
import { TodoStore } from '<plugin-dir>/src/store.ts';
import { runHooks } from '<plugin-dir>/src/services/hooks.ts';
const store = new TodoStore(process.argv[1]);
const todo = store.get(process.argv[2]);
if (todo) {
  await runHooks(process.argv[1], 'todo-finish', { cwd: process.argv[1], ...todo });
}
" "<cwd>" "<todo-id>"
```

若 `.harness/config.json` 不存在或 `todo-finish` 事件无配置，静默跳过，不影响默认流程。
```

- [ ] **Step 9: 提交**

```bash
cd /Users/bytedance/haha/x/agent/claude-about/easy-harness
git add skills/harness-todo-finish/SKILL.md
git commit -m "refactor: harness-todo-finish use config.json hooks instead of custom-* skill"
```

---

### Task 5: 修改 `harness-notice-user/SKILL.md`

**Files:**
- Modify: `skills/harness-notice-user/SKILL.md`

- [ ] **Step 10: 替换步骤 4a，保留 4a/4b 分支**

将现有步骤 4a（第 73-78 行）替换为：

```markdown
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
  await runHooks(process.argv[1], 'notice-user', JSON.parse(process.argv[2]));
  " "<cwd>" '<NoticeMessage JSON>'
  ```

- **输出 `false`**：走默认渠道（4b）。
```

- [ ] **Step 11: 提交**

```bash
cd /Users/bytedance/haha/x/agent/claude-about/easy-harness
git add skills/harness-notice-user/SKILL.md
git commit -m "refactor: harness-notice-user use config.json hooks instead of custom-* skill"
```

---

### Task 6: 重写 `README.md` Customization 章节

**Files:**
- Modify: `README.md`

- [ ] **Step 12: 替换 Customization 章节**

删除从 `## Customization` 到 `## Data` 之间的全部内容（第 57-133 行），替换为：

```markdown
## Customization

Easy Harness 的核心 skills 在关键流程节点预留了扩展钩子，通过 `.harness/config.json` 配置。

### 配置文件

在项目的 `.harness/config.json`（与 `todos.json` 同级）中添加 `hooks` 字段：

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
      }
    ]
  }
}
```

### Hook 类型

| type | 必填字段 | 说明 |
|------|----------|------|
| `command` | `command` | 执行 shell 命令，事件上下文通过 stdin JSON 传入 |
| `skill` | `skill` | 调用指定名称的 Claude Code skill，事件上下文作为参数传入 |

### 事件

| 事件名 | 触发时机 | 语义 |
|--------|----------|------|
| `todo-create` | 待办项创建完成后（记录已写入、tmux 会话已启动） | 追加增强（默认流程始终完整执行） |
| `todo-finish` | 待办项完成后（tmux 已关闭、状态已更新） | 追加增强（默认流程始终完整执行） |
| `notice-user` | 通知生成后 | 替代默认控制台输出（有配置走 hooks，无配置走控制台） |

### 执行规则

- 同一事件下多个 hook 按数组顺序逐个执行
- 单个 hook 失败不影响后续 hook
- 配置文件不存在或事件无配置时静默跳过

### Payload 示例

`todo-create` 和 `todo-finish` 的 stdin JSON：

```json
{
  "cwd": "/path/to/project",
  "id": "abc123",
  "title": "实现登录功能",
  "description": "用户描述...",
  "status": "running",
  "tmuxSessionId": "harness-abc123",
  "remoteControlUrl": "https://...",
  "claudeSessionId": "session_...",
  "claudeSessionName": "[HARNESS_SESSION]实现登录功能"
}
```

`notice-user` 的 stdin JSON：

```json
{
  "title": "实现登录功能",
  "status": "done",
  "summary": "已完成登录功能的实现...",
  "tmuxSessionId": "harness-abc123",
  "remoteControlUrl": "https://..."
}
```
```

- [ ] **Step 13: 提交**

```bash
cd /Users/bytedance/haha/x/agent/claude-about/easy-harness
git add README.md
git commit -m "docs: rewrite Customization section for .harness/config.json hooks"
```

---

### Task 7: 全量验证

- [ ] **Step 14: 运行全部测试**

Run: `cd /Users/bytedance/haha/x/agent/claude-about/easy-harness && npx vitest run`
Expected: 全部 PASS，无回归

- [ ] **Step 15: TypeScript 编译检查**

Run: `cd /Users/bytedance/haha/x/agent/claude-about/easy-harness && npx tsc --noEmit`
Expected: 无错误
