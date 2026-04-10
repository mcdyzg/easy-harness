import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface ExecutePromptProps {
  todoId: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function ExecutePrompt({ todoId, onSubmit, onCancel }: ExecutePromptProps) {
  const [value, setValue] = useState("");

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>发送消息到会话</Text>
        <Text color="gray"> (待办项: {todoId})</Text>
      </Box>
      <Box>
        <Text>消息: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(text) => {
            if (text.trim()) {
              onSubmit(text.trim());
            }
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Enter 发送 | Esc 取消</Text>
      </Box>
    </Box>
  );
}
