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
    const call = (child_process.execSync as ReturnType<typeof vi.fn>).mock
      .calls[0];
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
      .mockImplementationOnce(() => {
        throw new Error("fail");
      })
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
