import React, { useState } from "react";
import { Box, Text } from "ink";
import { TodoList } from "./components/TodoList.js";
import { TodoForm } from "./components/TodoForm.js";
import { ExecutePrompt } from "./components/ExecutePrompt.js";
import { TodoStore } from "../store.js";

type View = "list" | "create" | "edit" | "execute";

interface AppProps {
  cwd: string;
}

export function App({ cwd }: AppProps) {
  const [view, setView] = useState<View>("list");
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const store = new TodoStore(cwd);

  if (view === "create") {
    return (
      <TodoForm
        mode="create"
        onSubmit={(description) => {
          // 输出 JSON 供 SKILL.md 读取
          process.stdout.write(
            JSON.stringify({ action: "create", description }) + "\n"
          );
          setView("list");
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  if (view === "edit" && selectedTodoId) {
    const todo = store.get(selectedTodoId);
    return (
      <TodoForm
        mode="edit"
        initialValue={todo?.description ?? ""}
        onSubmit={(description) => {
          process.stdout.write(
            JSON.stringify({
              action: "edit",
              id: selectedTodoId,
              description,
            }) + "\n"
          );
          setView("list");
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  if (view === "execute" && selectedTodoId) {
    return (
      <ExecutePrompt
        todoId={selectedTodoId}
        onSubmit={(text) => {
          process.stdout.write(
            JSON.stringify({
              action: "execute",
              id: selectedTodoId,
              text,
            }) + "\n"
          );
          setView("list");
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  return (
    <TodoList
      store={store}
      onSelect={(id, action) => {
        setSelectedTodoId(id);
        if (action === "delete") {
          store.delete(id);
        } else {
          setView(action);
        }
      }}
      onCreate={() => setView("create")}
    />
  );
}
