import type { TodoItem } from "../types.js";

export function buildFirstMessage(todo: TodoItem, userMessage: string): string {
  if (todo.firstMessageSent) {
    return userMessage;
  }

  return `【待办项上下文】标题：${todo.title}；描述：${todo.description}；待办项 ID：${todo.id}。以下是用户指令：${userMessage}`;
}
