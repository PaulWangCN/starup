import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface ThinkingIndicatorProps {
  toolName: string | null;
  interruptible?: boolean;
}

const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ 
  toolName,
  interruptible 
}) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % spinners.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box paddingX={1}>
      <Text color="yellow">
        {spinners[frame]} {toolName ? `执行 ${toolName}...` : '思考中...'}
        {interruptible && ' (Ctrl+Enter 打断)'}
      </Text>
    </Box>
  );
};
