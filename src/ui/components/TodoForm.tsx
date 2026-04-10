import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface TodoFormProps {
  mode: "create" | "edit";
  initialValue?: string;
  onSubmit: (description: string) => void;
  onCancel: () => void;
}

export function TodoForm({
  mode,
  initialValue = "",
  onSubmit,
  onCancel,
}: TodoFormProps) {
  const [value, setValue] = useState(initialValue);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          {mode === "create" ? "新建待办项" : "编辑待办项"}
        </Text>
      </Box>
      <Box>
        <Text>描述: </Text>
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
        <Text color="gray">Enter 确认 | Esc 取消</Text>
      </Box>
    </Box>
  );
}
