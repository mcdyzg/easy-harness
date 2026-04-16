# Scheduled Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cron-based scheduled task execution to easy-harness, configured via `.harness/config.json`, managed through 3 new skills (start/stop/restart).

**Architecture:** A single Node process runs in a tmux session (`scheduler-<project>`), reads `schedules` from config.json, creates a `Cron` instance per entry, and executes commands via `execSync` or skills via `claude -p`. Three skills provide manual lifecycle management.

**Tech Stack:** TypeScript, croner (already a dependency), tmux, vitest

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/types.ts` | Add `ScheduleItem` union type |
| `src/services/scheduler.ts` | Config reading, validation, cron lifecycle, execution logic |
| `src/scripts/scheduler.ts` | CLI entry point: parse `--cwd`, call `runScheduler()` |
| `skills/harness-schedule-start/SKILL.md` | Start skill definition |
| `skills/harness-schedule-stop/SKILL.md` | Stop skill definition |
| `skills/harness-schedule-restart/SKILL.md` | Restart skill definition |
| `.claude-plugin/plugin.json` | Register 3 new skills |
| `tests/services/scheduler.test.ts` | Unit tests for validation + execution logic |

---

### Task 1: Add ScheduleItem types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add type definitions to `src/types.ts`**

Append after the existing `MessageSender` interface:

```typescript
interface ScheduleItemBase {
  name: string;
  cron: string;
}

export interface SkillSchedule extends ScheduleItemBase {
  type: "skill";
  skill: string;
}

export interface CommandSchedule extends ScheduleItemBase {
  type: "command";
  command: string;
}

export type ScheduleItem = SkillSchedule | CommandSchedule;
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(scheduler): add ScheduleItem type definitions"
```

---

### Task 2: Implement scheduler service with tests (TDD)

**Files:**
- Create: `src/services/scheduler.ts`
- Create: `tests/services/scheduler.test.ts`

- [ ] **Step 1: Write failing tests for `validateSchedules`**

Create `tests/services/scheduler.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateSchedules } from "../../src/services/scheduler.js";

describe("validateSchedules", () => {
  it("返回合法 schedule 并过滤无效项", () => {
    const input = [
      { name: "ok-cmd", cron: "0 9 * * *", type: "command" as const, command: "echo hi" },
      { name: "ok-skill", cron: "*/5 * * * *", type: "skill" as const, skill: "harness-todo-list" },
    ];
    const { valid, warnings } = validateSchedules(input);
    expect(valid).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("name 重复时跳过后者", () => {
    const input = [
      { name: "dup", cron: "0 9 * * *", type: "command" as const, command: "echo 1" },
      { name: "dup", cron: "0 10 * * *", type: "command" as const, command: "echo 2" },
    ];
    const { valid, warnings } = validateSchedules(input);
    expect(valid).toHaveLength(1);
    expect(valid[0].command).toBe("echo 1");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("dup");
  });

  it("cron 表达式非法时跳过", () => {
    const input = [
      { name: "bad-cron", cron: "not a cron", type: "command" as const, command: "echo" },
    ];
    const { valid, warnings } = validateSchedules(input);
    expect(valid).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("type=skill 缺少 skill 字段时跳过", () => {
    const input = [
      { name: "no-skill", cron: "0 9 * * *", type: "skill" as const } as any,
    ];
    const { valid, warnings } = validateSchedules(input);
    expect(valid).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("type=command 缺少 command 字段时跳过", () => {
    const input = [
      { name: "no-cmd", cron: "0 9 * * *", type: "command" as const } as any,
    ];
    const { valid, warnings } = validateSchedules(input);
    expect(valid).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("空数组返回空结果", () => {
    const { valid, warnings } = validateSchedules([]);
    expect(valid).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/services/scheduler.test.ts`
Expected: FAIL — module `../../src/services/scheduler.js` not found

- [ ] **Step 3: Implement `validateSchedules` in `src/services/scheduler.ts`**

Create `src/services/scheduler.ts`:

```typescript
import { Cron } from "croner";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ScheduleItem } from "../types.js";

export interface ValidationResult {
  valid: ScheduleItem[];
  warnings: string[];
}

export function validateSchedules(items: unknown[]): ValidationResult {
  const valid: ScheduleItem[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const s = item as Record<string, unknown>;
    const name = String(s.name ?? "");

    if (seen.has(name)) {
      warnings.push(`重复的 name "${name}"，跳过`);
      continue;
    }
    seen.add(name);

    // 校验 cron
    try {
      new Cron(String(s.cron ?? ""));
    } catch {
      warnings.push(`[${name}] cron 表达式非法: "${s.cron}"`);
      continue;
    }

    // 校验 type + 必填字段
    if (s.type === "skill") {
      if (!s.skill || typeof s.skill !== "string") {
        warnings.push(`[${name}] type=skill 但缺少 skill 字段`);
        continue;
      }
      valid.push({ name, cron: String(s.cron), type: "skill", skill: s.skill });
    } else if (s.type === "command") {
      if (!s.command || typeof s.command !== "string") {
        warnings.push(`[${name}] type=command 但缺少 command 字段`);
        continue;
      }
      valid.push({ name, cron: String(s.cron), type: "command", command: s.command });
    } else {
      warnings.push(`[${name}] 未知 type: "${s.type}"`);
    }
  }

  return { valid, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/services/scheduler.test.ts`
Expected: all 6 tests PASS

- [ ] **Step 5: Write failing tests for `executeSchedule`**

Append to `tests/services/scheduler.test.ts`:

```typescript
import { executeSchedule } from "../../src/services/scheduler.js";
import type { ScheduleItem } from "../../src/types.js";
import * as child_process from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// 更新 import 行，在顶部加入 vi：
// import { describe, it, expect, vi, beforeEach } from "vitest";

describe("executeSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("type=command 时用 execSync 执行命令", () => {
    const item: ScheduleItem = {
      name: "test-cmd",
      cron: "0 9 * * *",
      type: "command",
      command: "echo hello",
    };
    executeSchedule(item, "/tmp/test-cwd");
    expect(child_process.execSync).toHaveBeenCalledWith("echo hello", {
      cwd: "/tmp/test-cwd",
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("type=skill 时用 claude -p 执行", () => {
    const item: ScheduleItem = {
      name: "test-skill",
      cron: "0 9 * * *",
      type: "skill",
      skill: "harness-todo-list",
    };
    executeSchedule(item, "/tmp/test-cwd");
    const call = (child_process.execSync as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("claude");
    expect(call[0]).toContain("harness-todo-list");
    expect(call[1]).toMatchObject({ cwd: "/tmp/test-cwd" });
  });

  it("执行失败时不抛出，返回 error", () => {
    (child_process.execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("cmd failed");
    });
    const item: ScheduleItem = {
      name: "fail-cmd",
      cron: "0 9 * * *",
      type: "command",
      command: "bad-cmd",
    };
    const result = executeSchedule(item, "/tmp");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cmd failed");
  });

  it("执行成功时返回 ok", () => {
    const item: ScheduleItem = {
      name: "ok-cmd",
      cron: "0 9 * * *",
      type: "command",
      command: "echo ok",
    };
    const result = executeSchedule(item, "/tmp");
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run tests/services/scheduler.test.ts`
Expected: FAIL — `executeSchedule` not exported

- [ ] **Step 7: Implement `executeSchedule`**

Add to `src/services/scheduler.ts`:

```typescript
export interface ExecuteResult {
  ok: boolean;
  error?: string;
  durationMs?: number;
}

export function executeSchedule(item: ScheduleItem, cwd: string): ExecuteResult {
  const start = Date.now();
  try {
    if (item.type === "command") {
      execSync(item.command, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    } else {
      const escaped = item.skill.replace(/'/g, "'\\''");
      execSync(`claude -p '调用 ${escaped} skill'`, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    }
    return { ok: true, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, durationMs: Date.now() - start };
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/services/scheduler.test.ts`
Expected: all tests PASS

- [ ] **Step 9: Write failing tests for `loadSchedulesFromConfig`**

Append to `tests/services/scheduler.test.ts`:

```typescript
import { loadSchedulesFromConfig } from "../../src/services/scheduler.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("loadSchedulesFromConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeConfig = (config: unknown) => {
    const dir = path.join(tmpDir, ".harness");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config));
  };

  it("正常读取 schedules 并校验", () => {
    writeConfig({
      schedules: [
        { name: "a", cron: "0 9 * * *", type: "command", command: "echo" },
      ],
    });
    const { valid, warnings } = loadSchedulesFromConfig(tmpDir);
    expect(valid).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it("config.json 不存在时返回空", () => {
    const { valid, warnings } = loadSchedulesFromConfig(tmpDir);
    expect(valid).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("config.json 无 schedules 字段时返回空", () => {
    writeConfig({ hooks: {} });
    const { valid, warnings } = loadSchedulesFromConfig(tmpDir);
    expect(valid).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("schedules 不是数组时返回空并 warn", () => {
    writeConfig({ schedules: "bad" });
    const { valid, warnings } = loadSchedulesFromConfig(tmpDir);
    expect(valid).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });
});
```

Update import to include `afterEach`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npx vitest run tests/services/scheduler.test.ts`
Expected: FAIL — `loadSchedulesFromConfig` not exported

- [ ] **Step 11: Implement `loadSchedulesFromConfig`**

Add to `src/services/scheduler.ts`:

```typescript
export function loadSchedulesFromConfig(baseDir: string): ValidationResult {
  const configPath = path.join(baseDir, ".harness", "config.json");
  if (!fs.existsSync(configPath)) {
    return { valid: [], warnings: [] };
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return { valid: [], warnings: ["config.json 解析失败"] };
  }

  const schedules = config.schedules;
  if (!schedules) {
    return { valid: [], warnings: [] };
  }
  if (!Array.isArray(schedules)) {
    return { valid: [], warnings: ["schedules 字段不是数组"] };
  }

  return validateSchedules(schedules);
}
```

- [ ] **Step 12: Run all tests to verify they pass**

Run: `npx vitest run tests/services/scheduler.test.ts`
Expected: all tests PASS

- [ ] **Step 13: Commit**

```bash
git add src/services/scheduler.ts tests/services/scheduler.test.ts
git commit -m "feat(scheduler): implement scheduler service with validation and execution"
```

---

### Task 3: Implement `runScheduler` and CLI entry point

**Files:**
- Modify: `src/services/scheduler.ts`
- Create: `src/scripts/scheduler.ts`

- [ ] **Step 1: Add `runScheduler` to `src/services/scheduler.ts`**

Append to `src/services/scheduler.ts`:

```typescript
function log(level: "info" | "warn" | "error", msg: string): void {
  const line = `[${new Date().toISOString()}] ${level.padEnd(5)} ${msg}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

export interface RunSchedulerOptions {
  cwd: string;
}

export function runScheduler(opts: RunSchedulerOptions): void {
  const { cwd } = opts;
  const { valid, warnings } = loadSchedulesFromConfig(cwd);

  for (const w of warnings) {
    log("warn", w);
  }

  if (valid.length === 0) {
    log("info", "no valid schedules found, exiting");
    process.exit(0);
  }

  log("info", `scheduler started: ${valid.length} schedules loaded`);
  for (const s of valid) {
    const detail = s.type === "skill" ? `skill: ${s.skill}` : `command: ${s.command}`;
    log("info", `  [${s.name}] cron="${s.cron}" (${detail})`);
  }

  const crons: Cron[] = [];

  for (const item of valid) {
    const job = new Cron(item.cron, () => {
      const detail = item.type === "skill" ? `skill: ${item.skill}` : `command: ${item.command}`;
      log("info", `[${item.name}] triggered (${detail})`);

      const result = executeSchedule(item, cwd);

      if (result.ok) {
        log("info", `[${item.name}] completed (${result.durationMs}ms)`);
      } else {
        log("error", `[${item.name}] failed: ${result.error}`);
      }
    });
    crons.push(job);
  }

  const shutdown = (sig: string) => {
    log("info", `received ${sig}, stopping`);
    for (const c of crons) c.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
```

- [ ] **Step 2: Create CLI entry point `src/scripts/scheduler.ts`**

Create `src/scripts/scheduler.ts`:

```typescript
#!/usr/bin/env -S npx --yes tsx
// CLI: npx tsx scheduler.ts --cwd <path>

import { parseArgs } from "node:util";
import { runScheduler } from "../services/scheduler.js";

function main(): void {
  const { values } = parseArgs({
    options: {
      cwd: { type: "string" },
    },
    strict: true,
  });

  if (!values.cwd) {
    console.error("missing --cwd");
    process.exit(2);
  }

  runScheduler({ cwd: values.cwd });
}

main();
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all tests PASS (existing + new)

- [ ] **Step 5: Commit**

```bash
git add src/services/scheduler.ts src/scripts/scheduler.ts
git commit -m "feat(scheduler): add runScheduler and CLI entry point"
```

---

### Task 4: Create skill definitions

**Files:**
- Create: `skills/harness-schedule-start/SKILL.md`
- Create: `skills/harness-schedule-stop/SKILL.md`
- Create: `skills/harness-schedule-restart/SKILL.md`

- [ ] **Step 1: Create `skills/harness-schedule-start/SKILL.md`**

```markdown
---
name: harness-schedule-start
description: "Start the harness cron scheduler. Reads schedules from .harness/config.json and launches a background tmux session running cron jobs. Use when user wants to start scheduled tasks, enable cron jobs, or mentions 'schedule start'."
---

# Harness Schedule Start

启动定时任务调度器。读取 `.harness/config.json` 中的 `schedules` 配置，在后台 tmux 会话中启动 cron 调度进程。

## 处理流程

### 1. 确定会话名

```bash
PROJECT=$(basename "<cwd>")
SESSION="scheduler-${PROJECT}"
```

### 2. 检查是否已运行

```bash
tmux has-session -t "$SESSION" 2>/dev/null
```

- 已存在 → 告知用户：`调度器已在运行（${SESSION}）。如需重新加载配置，请先执行 /harness-schedule-stop 或使用 /harness-schedule-restart。`
- 不存在 → 继续

### 3. 校验配置

```bash
npx --yes tsx -e "
import { loadSchedulesFromConfig } from '<pluginRoot>/src/services/scheduler.ts';
const { valid, warnings } = loadSchedulesFromConfig(process.argv[1]);
console.log(JSON.stringify({ valid, warnings }));
" "<cwd>"
```

- `valid` 为空 → 告知用户：`未找到有效的 schedules 配置。请检查 .harness/config.json。`
- 有 warnings → 逐条展示

### 4. 启动 tmux 会话

```bash
tmux new-session -d -s "$SESSION" -c "<cwd>" \
  "npx --yes tsx '<pluginRoot>/src/scripts/scheduler.ts' --cwd '<cwd>'"
```

### 5. 回显

向用户输出确认：

> 调度器已启动（`${SESSION}`），加载了 N 条 schedule：
>
> | Name | Cron | Type | Target |
> |------|------|------|--------|
> | daily-review | 0 9 * * * | skill | harness-todo-list |
>
> - `tmux attach -t ${SESSION}` 查看日志
> - `/harness-schedule-stop` 停止调度器
```

- [ ] **Step 2: Create `skills/harness-schedule-stop/SKILL.md`**

```markdown
---
name: harness-schedule-stop
description: "Stop the harness cron scheduler. Kills the scheduler tmux session. Use when user wants to stop scheduled tasks, disable cron jobs, or mentions 'schedule stop'."
---

# Harness Schedule Stop

停止定时任务调度器。

## 处理流程

### 1. 确定会话名

```bash
PROJECT=$(basename "<cwd>")
SESSION="scheduler-${PROJECT}"
```

### 2. 检查是否在运行

```bash
tmux has-session -t "$SESSION" 2>/dev/null
```

- 不存在 → 告知用户：`调度器未在运行。`
- 存在 → 继续

### 3. 停止

```bash
tmux kill-session -t "$SESSION"
```

### 4. 回显

> 调度器已停止（`${SESSION}`）。
```

- [ ] **Step 3: Create `skills/harness-schedule-restart/SKILL.md`**

```markdown
---
name: harness-schedule-restart
description: "Restart the harness cron scheduler. Stops and re-starts the scheduler with fresh config. Use when user wants to restart scheduled tasks, reload schedule config, or mentions 'schedule restart'."
---

# Harness Schedule Restart

重启定时任务调度器。停止当前调度器（如果在运行），然后重新加载配置并启动。

## 处理流程

### 1. 确定会话名

```bash
PROJECT=$(basename "<cwd>")
SESSION="scheduler-${PROJECT}"
```

### 2. 停止（静默）

```bash
tmux kill-session -t "$SESSION" 2>/dev/null || true
```

无论是否存在，都不报错。

### 3. 执行 start 逻辑

按照 `harness-schedule-start` 的步骤 3-5 执行：校验配置 → 启动 tmux 会话 → 回显。

### 4. 回显

> 调度器已重启（`${SESSION}`），加载了 N 条 schedule。
> - `tmux attach -t ${SESSION}` 查看日志
```

- [ ] **Step 4: Verify skill files exist**

Run: `ls skills/harness-schedule-*/SKILL.md`
Expected: 3 files listed

- [ ] **Step 5: Commit**

```bash
git add skills/harness-schedule-start/SKILL.md skills/harness-schedule-stop/SKILL.md skills/harness-schedule-restart/SKILL.md
git commit -m "feat(scheduler): add start/stop/restart skill definitions"
```

---

### Task 5: Register skills in plugin.json

**Files:**
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Update `.claude-plugin/plugin.json`**

Add 3 new entries to the `skills` array:

```json
{
  "name": "easy-harness",
  "description": "Terminal-based todo management with tmux-backed Claude Code sessions",
  "version": "0.1.14",
  "skills": [
    "./skills/harness-todo-list",
    "./skills/harness-todo-create",
    "./skills/harness-todo-remove",
    "./skills/harness-todo-finish",
    "./skills/harness-session-send-user-message",
    "./skills/harness-notice-user",
    "./skills/harness-todo-polling",
    "./skills/harness-schedule-start",
    "./skills/harness-schedule-stop",
    "./skills/harness-schedule-restart"
  ]
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf-8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Run all tests to confirm nothing broke**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat(scheduler): register schedule skills in plugin.json"
```

---

### Task 6: Integration verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: all tests PASS

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Verify scheduler CLI can start and exit cleanly**

Create a temp config and run:

```bash
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.harness"
echo '{"schedules":[{"name":"test","cron":"* * * * *","type":"command","command":"echo tick"}]}' > "$TMPDIR/.harness/config.json"
timeout 3 npx tsx src/scripts/scheduler.ts --cwd "$TMPDIR" || true
rm -rf "$TMPDIR"
```

Expected: see log output `scheduler started: 1 schedules loaded`, then timeout exits after 3s.

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix(scheduler): integration fixups"
```

Only commit if there were changes needed. If all was clean, skip this step.
