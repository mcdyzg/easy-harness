import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { debugLog } from "../utils/debug-log.js";

export interface ConversationTurn {
  userMessage: string;
  assistantMessage: string;
}

interface JournalEntry {
  type: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
}

function extractTextContent(
  content: string | Array<{ type: string; text?: string }>
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text!)
    .join("\n");
}

export function getLastConversationTurn(
  filePath: string
): ConversationTurn | undefined {
  if (!fs.existsSync(filePath)) {
    debugLog("session-log", "parse-ok", { filePath, hasUser: false, hasAssistant: false });
    return undefined;
  }

  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
  let lastUser: string | undefined;
  let lastAssistant: string | undefined;

  // 从后往前找最后一对 user + assistant
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry: JournalEntry = JSON.parse(lines[i]);

    if (
      !lastAssistant &&
      entry.type === "assistant" &&
      entry.message?.content
    ) {
      lastAssistant = extractTextContent(entry.message.content);
    }

    if (
      lastAssistant &&
      !lastUser &&
      entry.type === "user" &&
      entry.message?.role === "user"
    ) {
      const content = entry.message.content;
      // 跳过 tool_result 类型的 user 消息
      if (typeof content === "string") {
        lastUser = content;
      } else if (
        Array.isArray(content) &&
        content.some((b) => b.type === "text")
      ) {
        lastUser = extractTextContent(content);
      } else {
        continue;
      }
    }

    if (lastUser && lastAssistant) {
      debugLog("session-log", "parse-ok", { filePath, hasUser: true, hasAssistant: true });
      return { userMessage: lastUser, assistantMessage: lastAssistant };
    }
  }

  debugLog("session-log", "parse-ok", {
    filePath,
    hasUser: !!lastUser,
    hasAssistant: !!lastAssistant,
  });
  return undefined;
}

export function findSessionLogFile(
  sessionId: string
): string | undefined {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeDir)) {
    debugLog("session-log", "lookup", { sessionId, found: false });
    return undefined;
  }

  // 遍历项目目录，查找匹配的 session JSONL 文件
  const projectDirs = fs.readdirSync(claudeDir);
  for (const projectDir of projectDirs) {
    const projectPath = path.join(claudeDir, projectDir);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const sessionFile = path.join(projectPath, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionFile)) {
      debugLog("session-log", "lookup", { sessionId, found: true });
      return sessionFile;
    }
  }

  debugLog("session-log", "lookup", { sessionId, found: false });
  return undefined;
}
