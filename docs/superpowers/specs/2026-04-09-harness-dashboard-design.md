# Harness Dashboard 设计规格

## 概述

一个独立的 Claude Code skill 包，提供基于终端的待办项管理系统。用户可以通过 Ink 终端 UI 管理待办项，每个待办项关联一个独立的 Claude Code 会话（通过 tmux 启动），支持远程消息发送和对话结束后的自动通知。

## 数据模型

### 待办项（TodoItem）

存储位置：`.harness/todos.json`（当前工作目录下）

```typescript
interface TodoItem {
  id: string;                // 自动生成的唯一 ID
  title: string;             // 由 skill 根据描述自动总结
  description: string;       // 用户输入的原始描述
  status: 'pending' | 'running' | 'done' | 'failed';
  tmuxSessionId: string;     // tmux 会话 ID
  remoteControlUrl: string;  // claude --remote-control 生成的 URL
  claudeSessionId: string;   // Claude Code 的 session ID
  claudeSessionName: string; // Claude Code 的 session name（即 -n 参数值）
}
```

状态流转：`pending` → `running` → `done` / `failed`

## Skills

本项目包含 4 个 skill + 1 个 hook 配置，作为独立 skill 包发布。

### 1. `/harness-todo-create`

**触发方式：**
- 在任意 Claude Code 对话中直接调用
- 从 dashboard UI 中新建操作触发

**输入：** 用户提供描述（纯文本），可能包含 meego 需求链接等外部引用。

**处理流程：**
1. 分析用户描述，必要时调用 `/bytedcli` 等工具获取外部信息（如 meego 需求详情）
2. 根据描述自动总结生成标题
3. 生成唯一 ID
4. 创建待办项记录，初始状态为 `pending`，写入 `.harness/todos.json`
5. 通过 tmux 启动新的 Claude Code 会话：
   ```bash
   claude -n '[HARNESS_SESSION]<title>' '当前任务信息是：<description>；当前待办项的id是<id>'
   ```
   启动时附加 `--remote-control` 参数
6. 将 tmux 对话 ID、remote-control URL、Claude session ID、Claude session name 记录回待办项对应字段
7. 待办项状态更新为 `running`

### 2. `/harness-dashboard`

**触发方式：** 在任意 Claude Code 对话中调用。

**实现方式：** 使用 Ink（React for CLI）渲染终端 UI。

**功能：**

| 操作 | 说明 |
|------|------|
| 展示列表 | 显示所有待办项（标题、状态、ID） |
| 新建 | 弹出输入框，用户输入描述后调用 `/harness-todo-create` |
| 编辑 | 修改待办项的描述/标题 |
| 删除 | 移除待办项记录 |
| 执行 | 弹出输入框，用户输入文本后调用 `/harness-session-send-user-message` 将文本发送到对应会话 |

### 3. `/harness-session-send-user-message`

**触发方式：**
- 从 dashboard UI 中"执行"操作触发
- 在任意 Claude Code 对话中直接调用

**输入：** 待办项 ID + 用户文本

**处理流程：**
1. 根据待办项 ID 从 `.harness/todos.json` 读取对应的 tmux 会话 ID
2. 通过 `tmux send-keys` 将用户文本发送到对应 tmux 会话

### 4. `/harness-notice-user`

**触发方式：** 由 hook 在 Claude Code 对话结束后自动触发。

**设计：** 抽象消息推送接口，具体推送端（飞书、Telegram、Discord 等）后续扩展。

**消息内容：**
- 待办项标题
- 待办项状态
- Claude 对话的最后一段输出摘要
- tmux 对话 ID
- remote-control URL

**接口抽象：**
```typescript
interface MessageSender {
  send(message: NoticeMessage): Promise<void>;
}

interface NoticeMessage {
  title: string;
  status: string;
  summary: string;       // 对话最后一段输出摘要
  tmuxSessionId: string;
  remoteControlUrl: string;
}
```

### 5. Hook 配置

**触发时机：** 每次 Claude Code 对话结束后

**行为：** 自动调用 `/harness-notice-user`，将待办项相关信息推送到外部端。

**配置方式：** 通过 Claude Code 的 hook 机制注册，在 `settings.json` 中配置对话结束事件的 hook。

**关联待办项的方式：**
- Claude 会话启动时使用 `-n '[HARNESS_SESSION]<title>'` 命名，hook 脚本通过检测当前 tmux 会话名是否带 `[HARNESS_SESSION]` 前缀来判断是否为 harness 管理的会话
- 若是，则通过 tmux session ID 在 `.harness/todos.json` 中查找对应待办项
- 非 harness 会话直接跳过，不触发通知

**获取对话最后输出摘要：**
- 根据待办项中记录的 `claudeSessionId`，在 `~/.claude/projects/` 目录下找到对应的 `.jsonl` 会话日志文件
- 解析 JSONL 文件，提取最后一轮对话（最后的 user 消息和 assistant 消息）
- 基于最后一轮对话内容生成摘要

## 技术栈

| 技术 | 用途 |
|------|------|
| TypeScript | skill 开发语言 |
| Ink (React for CLI) | dashboard 终端 UI |
| tmux | Claude Code 会话管理 |
| 本地 JSON 文件 | 数据持久化 |

## 目录结构（skill 包）

```
harness-dashboard/
├── package.json
├── tsconfig.json
├── src/
│   ├── skills/
│   │   ├── harness-dashboard/
│   │   │   └── SKILL.md
│   │   ├── harness-todo-create/
│   │   │   └── SKILL.md
│   │   ├── harness-session-send-user-message/
│   │   │   └── SKILL.md
│   │   └── harness-notice-user/
│   │       └── SKILL.md
│   ├── components/          # Ink UI 组件
│   │   ├── Dashboard.tsx
│   │   ├── TodoList.tsx
│   │   ├── TodoForm.tsx
│   │   └── ExecutePrompt.tsx
│   ├── store/               # 数据存取
│   │   └── todo-store.ts
│   ├── services/
│   │   ├── tmux.ts          # tmux 操作封装
│   │   └── notice.ts        # 消息推送抽象接口
│   └── utils/
│       └── id.ts            # ID 生成
└── hook/
    └── on-session-end.sh    # hook 脚本
```

## 运行时数据

```
<工作目录>/
└── .harness/
    └── todos.json           # 待办项持久化存储
```
