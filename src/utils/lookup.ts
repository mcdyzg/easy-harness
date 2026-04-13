import type { TodoItem } from "../types.js";

// 查找结果：要么直接命中，要么需要用户确认
export type LookupResult =
  | { mode: "match"; todo: TodoItem }
  | { mode: "confirm"; candidates: TodoItem[] };

export type LookupErrorCode = "OUT_OF_RANGE" | "NOT_FOUND";

export class LookupError extends Error {
  constructor(public code: LookupErrorCode, message: string) {
    super(message);
    this.name = "LookupError";
  }
}

const NUMERIC = /^\d+$/;

// 首次查找：序号 → ID 精确 → title 模糊（substring，大小写不敏感）
export function lookupTodo(input: string, items: TodoItem[]): LookupResult {
  const trimmed = input.trim();

  if (NUMERIC.test(trimmed)) {
    const idx = parseInt(trimmed, 10) - 1;
    if (idx < 0 || idx >= items.length) {
      throw new LookupError(
        "OUT_OF_RANGE",
        `序号越界：共 ${items.length} 条待办项，有效范围 1–${items.length}`,
      );
    }
    return { mode: "match", todo: items[idx] };
  }

  const byId = items.find((it) => it.id === trimmed);
  if (byId) {
    return { mode: "match", todo: byId };
  }

  const needle = trimmed.toLowerCase();
  const candidates = items.filter((it) =>
    it.title.toLowerCase().includes(needle),
  );
  if (candidates.length === 0) {
    throw new LookupError(
      "NOT_FOUND",
      "未找到匹配的待办项：请检查序号、ID 或 title 片段是否正确",
    );
  }

  return { mode: "confirm", candidates };
}

// 候选确认阶段：序号 → ID 精确，不再模糊匹配以避免发散
export function resolveCandidate(
  input: string,
  candidates: TodoItem[],
): TodoItem {
  const trimmed = input.trim();

  if (NUMERIC.test(trimmed)) {
    const idx = parseInt(trimmed, 10) - 1;
    if (idx < 0 || idx >= candidates.length) {
      throw new LookupError(
        "OUT_OF_RANGE",
        `候选序号越界：共 ${candidates.length} 条候选项，有效范围 1–${candidates.length}`,
      );
    }
    return candidates[idx];
  }

  const byId = candidates.find((it) => it.id === trimmed);
  if (byId) return byId;

  throw new LookupError(
    "NOT_FOUND",
    "仍未能定位：请重新执行 /harness-session-send-user-message",
  );
}
