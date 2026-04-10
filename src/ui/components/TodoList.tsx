import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TodoStore } from "../../store.js";
import type { TodoStatus } from "../../types.js";

const STATUS_COLORS: Record<TodoStatus, string> = {
  pending: "gray",
  running: "blue",
  done: "green",
  failed: "red",
};

interface TodoListProps {
  store: TodoStore;
  onSelect: (id: string, action: "edit" | "delete" | "execute") => void;
  onCreate: () => void;
}

export function TodoList({ store, onSelect, onCreate }: TodoListProps) {
  const items = store.list();
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setCursor((prev) => Math.min(items.length - 1, prev + 1));
    }
    if (input === "n") {
      onCreate();
    }
    if (input === "e" && items[cursor]) {
      onSelect(items[cursor].id, "edit");
    }
    if (input === "d" && items[cursor]) {
      onSelect(items[cursor].id, "delete");
    }
    if (input === "x" && items[cursor]) {
      onSelect(items[cursor].id, "execute");
    }
    if (input === "q") {
      process.exit(0);
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Harness Dashboard</Text>
      </Box>

      {items.length === 0 ? (
        <Text color="gray">暂无待办项。按 n 新建。</Text>
      ) : (
        items.map((item, index) => (
          <Box key={item.id}>
            <Text color={index === cursor ? "cyan" : undefined}>
              {index === cursor ? "▸ " : "  "}
            </Text>
            <Text color={STATUS_COLORS[item.status]}>[{item.status}]</Text>
            <Text> {item.title}</Text>
            <Text color="gray"> ({item.id})</Text>
          </Box>
        ))
      )}

      <Box marginTop={1}>
        <Text color="gray">
          ↑↓ 移动 | n 新建 | e 编辑 | d 删除 | x 执行 | q 退出
        </Text>
      </Box>
    </Box>
  );
}
