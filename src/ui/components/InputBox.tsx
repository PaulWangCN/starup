import React from 'react';
import { Box, Text } from 'ink';

interface InputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

export const InputBox: React.FC<InputBoxProps> = ({ 
  value, 
  disabled 
}) => (
  <Box borderStyle="single" borderColor={disabled ? 'gray' : 'cyan'} paddingX={1}>
    <Text color={disabled ? 'gray' : 'cyan'}>{'>'}</Text>
    <Text> {value}</Text>
    {!disabled && <Text color="gray">_</Text>}
  </Box>
);
