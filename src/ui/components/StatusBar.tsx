import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  skills: number;
  tools: number;
  sessionId: string | null;
  isProcessing: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({ 
  skills, 
  tools, 
  sessionId,
  isProcessing 
}) => (
  <Box 
    borderStyle="single" 
    borderColor="gray" 
    paddingX={1}
    justifyContent="space-between"
  >
    <Box>
      <Text color="blue">Skills: </Text>
      <Text>{skills}</Text>
      <Text> | </Text>
      <Text color="blue">Tools: </Text>
      <Text>{tools}</Text>
    </Box>
    
    <Box>
      {isProcessing && (
        <Text color="yellow">⏳ 处理中... (Ctrl+Enter 打断)</Text>
      )}
    </Box>
    
    <Box>
      <Text color="gray">
        Session: {sessionId?.substring(0, 8)}...
      </Text>
    </Box>
  </Box>
);
