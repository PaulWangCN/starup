import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  title: string;
  version: string;
}

export const Header: React.FC<HeaderProps> = ({ title, version }) => (
  <Box borderStyle="double" borderColor="green" paddingX={2} paddingY={1}>
    <Text color="green" bold>
      {title} <Text color="gray">v{version}</Text>
    </Text>
  </Box>
);
