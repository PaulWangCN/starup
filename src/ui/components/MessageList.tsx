import React from 'react';
import { Box, Text } from 'ink';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  metadata?: {
    toolName?: string;
    toolResult?: any;
    thinking?: boolean;
  };
}

interface MessageListProps {
  messages: Message[];
  scrollOffset: number;
  maxHeight?: number;
}

export const MessageList: React.FC<MessageListProps> = ({ 
  messages, 
  scrollOffset,
  maxHeight = 20 
}) => {
  // 只显示最近的消息
  const visibleMessages = messages.slice(-maxHeight);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visibleMessages.map((message) => {
        const time = new Date(message.timestamp).toLocaleTimeString();
        
        switch (message.role) {
          case 'user':
            return (
              <Box key={message.id} marginY={1}>
                <Text color="cyan" bold>{'> '}</Text>
                <Text>{message.content}</Text>
              </Box>
            );
          
          case 'assistant':
            return (
              <Box key={message.id} marginY={1} flexDirection="column">
                <Text color="green" bold>🤖 AI</Text>
                <Text>{message.content || (message.metadata?.thinking ? '思考中...' : '')}</Text>
              </Box>
            );
          
          case 'system':
            return (
              <Box key={message.id} marginY={1}>
                <Text color="gray">[{time}] {message.content}</Text>
              </Box>
            );
          
          case 'tool':
            return (
              <Box key={message.id} marginY={1} paddingLeft={2}>
                <Text color="yellow">🔧 {message.content}</Text>
              </Box>
            );
          
          default:
            return null;
        }
      })}
    </Box>
  );
};
