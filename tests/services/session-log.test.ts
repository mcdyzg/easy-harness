import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLastConversationTurn, findSessionLogFile } from "../../src/services/session-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("getLastConversationTurn", () => {
  const fixturePath = path.join(__dirname, "../fixtures/sample-session.jsonl");

  it("extracts the last user message", () => {
    const result = getLastConversationTurn(fixturePath);
    expect(result?.userMessage).toBe("请加上错误处理");
  });

  it("extracts the last assistant message", () => {
    const result = getLastConversationTurn(fixturePath);
    expect(result?.assistantMessage).toBe(
      "已添加错误处理逻辑，现在函数会捕获异常并返回默认值。"
    );
  });

  it("returns undefined for non-existent file", () => {
    const result = getLastConversationTurn("/nonexistent/file.jsonl");
    expect(result).toBeUndefined();
  });
});

describe("findSessionLogFile", () => {
  it("returns undefined for non-existent session", () => {
    const result = findSessionLogFile("nonexistent-session-id");
    expect(result).toBeUndefined();
  });
});
