import React from 'react';
import { Box, Text } from 'ink';

interface ToolCallDisplayProps {
  name: string;
  args?: any;
  result?: any;
  status: 'calling' | 'success' | 'error';
}

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({ 
  name, 
  args, 
  result, 
  status 
}) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'calling': return '⏳';
      case 'success': return '✓';
      case 'error': return '✗';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'calling': return 'yellow';
      case 'success': return 'green';
      case 'error': return 'red';
    }
  };

  return (
    <Box paddingLeft={2} flexDirection="column">
      <Text color={getStatusColor()}>
        {getStatusIcon()} {name}
      </Text>
      {args && (
        <Text color="gray">  参数: {JSON.stringify(args).substring(0, 100)}</Text>
      )}
      {result && status !== 'calling' && (
        <Text color={status === 'success' ? 'gray' : 'red'}>
          {'  '}结果: {status === 'success' ? '成功' : result.error || '失败'}
        </Text>
      )}
    </Box>
  );
};
