#!/usr/bin/env -S npx --yes tsx
// Stop hook 真正的派发入口：一次进程内完成
//   1. 根据 tmuxSession 找 todo
//   2. running → pending 状态流转
//   3. 读 transcript 最后一轮
//   4. 组装 NoticeMessage
//   5. 触发 notice-user hooks 或 fallback 到 console 输出
//
// 设计目标：替换原来 on-stop.sh → claude -p → harness-notice-user skill
// 这条经过 LLM 的长链路，端到端只保留一次 `npx tsx` 冷启动 + 最终脚本执行。
// 失败时静默退出 0，绝不影响调用方。

import { TodoStore } from "../store.js";
import { getLastConversationTurn } from "../services/session-log.js";
import { runHooks, hasConfiguredHooks } from "../services/hooks.js";
import { formatNoticeMessage } from "../services/notice.js";
import { debugLog } from "../utils/debug-log.js";
import type { NoticeMessage } from "../types.js";

async function main(): Promise<void> {
  const [cwd, tmuxSession, transcriptPath = ""] = process.argv.slice(2);
  const start = Date.now();

  if (!cwd || !tmuxSession) {
    debugLog("on-stop-dispatch", "bad-args", {
      cwd,
      tmuxSession,
      transcriptPath,
    });
    return;
  }

  // debug-log 里的 resolve() 基于 process.cwd() 查找 .harness/config.json；
  // Stop hook 触发时 cwd 未必等于 todo 的 cwd，主动切过去让日志和 runHooks 目录一致
  try {
    process.chdir(cwd);
  } catch {
    // cwd 不可访问时静默忽略，让后续 TodoStore 自己抛合适的错
  }

  const store = new TodoStore(cwd);
  const todo = store.list().find((t) => t.tmuxSessionId === tmuxSession);
  if (!todo) {
    debugLog("on-stop-dispatch", "todo-missing", { cwd, tmuxSession });
    return;
  }

  // running → pending：避免覆盖 done/failed
  if (todo.status === "running") {
    store.update(todo.id, { status: "pending" });
  }

  // 读 transcript 最后一轮（读不到就透传空字符串，由渠道自己决定怎么展示）
  const turn = transcriptPath
    ? getLastConversationTurn(transcriptPath)
    : undefined;

  const latest = store.get(todo.id) ?? todo;
  const payload: NoticeMessage = {
    title: latest.title,
    status: latest.status,
    userMessage: turn?.userMessage ?? "",
    assistantMessage: turn?.assistantMessage ?? "",
    tmuxSessionId: latest.tmuxSessionId,
    remoteControlUrl: latest.remoteControlUrl,
    metadata: latest.metadata,
  };

  debugLog("on-stop-dispatch", "payload-ready", {
    todoId: todo.id,
    status: payload.status,
    hasUserMessage: payload.userMessage.length > 0,
    hasAssistantMessage: payload.assistantMessage.length > 0,
    transcriptPath,
  });

  // 有配置就走 hooks；没配置就 fallback 到默认控制台渲染
  const hasHooks = hasConfiguredHooks(cwd, "notice-user");
  if (hasHooks) {
    await runHooks(
      cwd,
      "notice-user",
      payload as unknown as Record<string, unknown>
    );
  } else {
    console.log(formatNoticeMessage(payload));
  }

  debugLog("on-stop-dispatch", "done", {
    todoId: todo.id,
    hasHooks,
    durationMs: Date.now() - start,
  });
}

main().catch((err) => {
  debugLog("on-stop-dispatch", "fatal", {
    error: err instanceof Error ? err.message : String(err),
  });
  // 不 exit 1——避免 Stop hook 把错误暴给主会话
});
