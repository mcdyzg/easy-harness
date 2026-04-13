import { describe, it, expect } from "vitest";
import { lookupTodo, resolveCandidate, LookupError } from "../../src/utils/lookup.js";
import type { TodoItem } from "../../src/types.js";

const makeTodo = (overrides: Partial<TodoItem>): TodoItem => ({
  id: "id-default",
  title: "Default Title",
  description: "",
  status: "pending",
  tmuxSessionId: "",
  remoteControlUrl: "",
  claudeSessionId: "",
  claudeSessionName: "",
  ...overrides,
});

const items: TodoItem[] = [
  makeTodo({ id: "abc123def456", title: "实现登录功能" }),
  makeTodo({ id: "xyz789ghi012", title: "登录页样式调整" }),
  makeTodo({ id: "jkl345mno678", title: "性能优化" }),
];

describe("lookupTodo", () => {
  describe("序号路径", () => {
    it("按 1-based 序号定位首项", () => {
      const r = lookupTodo("1", items);
      expect(r).toEqual({ mode: "match", todo: items[0] });
    });

    it("按 1-based 序号定位末项", () => {
      const r = lookupTodo("3", items);
      expect(r).toEqual({ mode: "match", todo: items[2] });
    });

    it("input 含前后空格也能识别为序号", () => {
      const r = lookupTodo("  2  ", items);
      expect(r).toEqual({ mode: "match", todo: items[1] });
    });

    it("序号 0 抛 OUT_OF_RANGE", () => {
      expect(() => lookupTodo("0", items)).toThrow(LookupError);
      try { lookupTodo("0", items); } catch (e) {
        expect((e as LookupError).code).toBe("OUT_OF_RANGE");
        expect((e as LookupError).message).toContain("有效范围 1–3");
      }
    });

    it("序号超过长度抛 OUT_OF_RANGE", () => {
      expect(() => lookupTodo("4", items)).toThrow(LookupError);
    });

    it("空列表上的序号查询抛 OUT_OF_RANGE", () => {
      expect(() => lookupTodo("1", [])).toThrow(LookupError);
    });
  });

  describe("ID 精确匹配", () => {
    it("命中完整 nanoid", () => {
      const r = lookupTodo("xyz789ghi012", items);
      expect(r).toEqual({ mode: "match", todo: items[1] });
    });

    it("ID 大小写敏感", () => {
      expect(() => lookupTodo("ABC123DEF456", items)).toThrow(LookupError);
    });
  });

  describe("title 模糊匹配", () => {
    it("单条命中也走 confirm 路径", () => {
      const r = lookupTodo("性能", items);
      expect(r.mode).toBe("confirm");
      if (r.mode === "confirm") {
        expect(r.candidates).toEqual([items[2]]);
      }
    });

    it("多条命中返回所有候选", () => {
      const r = lookupTodo("登录", items);
      expect(r.mode).toBe("confirm");
      if (r.mode === "confirm") {
        expect(r.candidates).toEqual([items[0], items[1]]);
      }
    });

    it("大小写不敏感", () => {
      const list = [makeTodo({ id: "uniq111aaa22", title: "Login Refactor" })];
      const r = lookupTodo("login", list);
      expect(r.mode).toBe("confirm");
      if (r.mode === "confirm") {
        expect(r.candidates).toEqual([list[0]]);
      }
    });

    it("零命中抛 NOT_FOUND", () => {
      expect(() => lookupTodo("不存在的关键词", items)).toThrow(LookupError);
      try { lookupTodo("不存在的关键词", items); } catch (e) {
        expect((e as LookupError).code).toBe("NOT_FOUND");
      }
    });

    it("仅匹配 title，不匹配 description", () => {
      const list = [makeTodo({ id: "iddd123aaa44", title: "无关标题", description: "包含关键词xyz" })];
      expect(() => lookupTodo("xyz", list)).toThrow(LookupError);
    });
  });
});

describe("resolveCandidate", () => {
  const candidates: TodoItem[] = [
    makeTodo({ id: "c1aaaabbbb11", title: "实现登录功能" }),
    makeTodo({ id: "c2ccccdddd22", title: "登录页样式调整" }),
  ];

  it("按候选序号定位", () => {
    expect(resolveCandidate("2", candidates)).toBe(candidates[1]);
  });

  it("按 ID 定位", () => {
    expect(resolveCandidate("c1aaaabbbb11", candidates)).toBe(candidates[0]);
  });

  it("候选序号越界抛 OUT_OF_RANGE", () => {
    expect(() => resolveCandidate("3", candidates)).toThrow(LookupError);
  });

  it("非纯数字且未匹配 ID 抛 NOT_FOUND（不再做模糊匹配）", () => {
    expect(() => resolveCandidate("登录", candidates)).toThrow(LookupError);
    try { resolveCandidate("登录", candidates); } catch (e) {
      expect((e as LookupError).code).toBe("NOT_FOUND");
    }
  });
});
