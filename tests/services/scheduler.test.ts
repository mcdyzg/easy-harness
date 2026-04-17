import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  it("未知 type 时跳过并 warn", () => {
    const input = [
      { name: "bad-type", cron: "0 9 * * *", type: "weird" } as any,
    ];
    const { valid, warnings } = validateSchedules(input);
    expect(valid).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("未知 type");
  });

  it("type=skill 带 args 时透传 args", () => {
    const input = [
      { name: "s", cron: "0 9 * * *", type: "skill" as const, skill: "x", args: "我是消息" },
    ];
    const { valid } = validateSchedules(input);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ type: "skill", skill: "x", args: "我是消息" });
  });

  it("type=skill 无 args 时不设置 args", () => {
    const input = [
      { name: "s", cron: "0 9 * * *", type: "skill" as const, skill: "x" },
    ];
    const { valid } = validateSchedules(input);
    expect(valid).toHaveLength(1);
    expect((valid[0] as any).args).toBeUndefined();
  });

  it("name 缺失或为空时跳过", () => {
    const input = [
      { cron: "0 9 * * *", type: "command", command: "echo" } as any,
      { name: "", cron: "0 9 * * *", type: "command", command: "echo" } as any,
    ];
    const { valid, warnings } = validateSchedules(input);
    expect(valid).toHaveLength(0);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("缺少 name");
  });
});

import { executeSchedule } from "../../src/services/scheduler.js";
import type { ScheduleItem } from "../../src/types.js";
import * as child_process from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

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
    expect(call[0]).not.toContain("参数");
    expect(call[1]).toMatchObject({ cwd: "/tmp/test-cwd" });
  });

  it("type=skill 带 args 时把参数拼入 prompt", () => {
    const item: ScheduleItem = {
      name: "with-args",
      cron: "0 9 * * *",
      type: "skill",
      skill: "harness-custom-notice-user",
      args: "我是消息",
    };
    executeSchedule(item, "/tmp/test-cwd");
    const call = (child_process.execSync as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("harness-custom-notice-user");
    expect(call[0]).toContain("参数：我是消息");
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
