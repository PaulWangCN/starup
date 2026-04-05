#!/usr/bin/env node
/**
 * StarUp AI Agent - Ink UI 入口
 * 现代化终端界面，支持实时对话、工具调用展示、打断功能
 */

// 全局错误处理 - 防止进程崩溃
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// 加载环境变量
import dotenv from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

// Env loaded

// 动态导入核心模块（使用 createRequire 兼容 CJS）
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const loadCore = async () => {
  return require('../../dist/index.js');
};

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  metadata?: {
    toolName?: string;
    toolArgs?: any;
  };
}

// 主应用组件
const App: React.FC = () => {
  const { exit } = useApp();
  
  const [core, setCore] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState({ skills: 0, tools: 0 });
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // 初始化
  useEffect(() => {
    const init = async () => {
      try {
        const coreModule = await loadCore();
        const StarUpCore = coreModule.StarUpCore;
        
        const newCore = new StarUpCore();
        await newCore.initialize();
        setCore(newCore);

        const mainSession = newCore.sessionManager.initializeMainSession();
        setSessionId(mainSession.id);
        newCore.registerSession(mainSession.id);

        setStatus(newCore.getStatus());
        setIsReady(true);

        addMessage({
          id: generateId('welcome'),
          role: 'system',
          content: 'StarUp AI Agent Started\nType /help for help, Ctrl+C to exit',
          timestamp: Date.now(),
        });
      } catch (error) {
        addMessage({
          id: generateId('init-error'),
          role: 'system',
          content: `Init failed: ${error}`,
          timestamp: Date.now(),
        });
        setIsReady(true);
      }
    };

    init();
  }, []);

  // 生成唯一 ID
  const generateId = useCallback((prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // 添加消息
  const addMessage = useCallback((message: Message) => {
    setMessages(prev => [...prev, message]);
  }, []);

  // 更新最后一条消息（流式）
  const updateLastMessage = useCallback((content: string) => {
    setMessages(prev => {
      const newMessages = [...prev];
      const lastMsg = newMessages[newMessages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content = content;
      }
      return newMessages;
    });
  }, []);

  // 处理提交
  const handleSubmit = useCallback(async () => {
    if (!inputValue.trim() || !core || !sessionId || isProcessing) return;

    const text = inputValue.trim();
    setInputValue('');

    if (text.startsWith('/')) {
      await handleCommand(text);
      return;
    }

    addMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });

    const controller = new AbortController();
    setAbortController(controller);
    setIsProcessing(true);
    setCurrentTool(null);

    const assistantMsgId = generateId('assistant');
    addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });

    try {
      let fullContent = '';
      
      const result = await core.processMessage(sessionId, text, {
        onStreamChunk: (chunk: string) => {
          if (controller.signal.aborted) return;
          fullContent += chunk;
          updateLastMessage(fullContent);
        },
        onToolCall: (name: string) => {
          if (controller.signal.aborted) return;
          setCurrentTool(name);
        },
      });

      if (!controller.signal.aborted) {
        updateLastMessage(result.finalReply);
      }
    } catch (error: any) {
      if (!controller.signal.aborted) {
        addMessage({
          id: generateId('error'),
          role: 'system',
          content: `Error: ${error.message || error}`,
          timestamp: Date.now(),
        });
      }
    } finally {
      setIsProcessing(false);
      setAbortController(null);
      setCurrentTool(null);
    }
  }, [inputValue, core, sessionId, isProcessing]);

  // 处理命令
  const handleCommand = async (command: string) => {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0];

    switch (cmd) {
      case 'help':
        setShowHelp(true);
        setTimeout(() => setShowHelp(false), 5000);
        break;
      case 'exit':
      case 'quit':
        exit();
        break;
      case 'clear':
        setMessages([]);
        break;
      case 'status':
        addMessage({
          id: generateId('cmd'),
          role: 'system',
          content: `Skills: ${status.skills} | Tools: ${status.tools}`,
          timestamp: Date.now(),
        });
        break;
      default:
        addMessage({
          id: `cmd-${Date.now()}`,
          role: 'system',
          content: `Unknown: ${cmd}`,
          timestamp: Date.now(),
        });
    }
  };

  // 停止生成
  const handleStop = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsProcessing(false);
      addMessage({
        id: generateId('stop'),
        role: 'system',
        content: 'Stopped',
        timestamp: Date.now(),
      });
    }
  }, [abortController]);

  // 键盘处理
  useInput((input, key) => {
    if (key.return) {
      if (isProcessing) {
        handleStop();
      } else {
        handleSubmit();
      }
      return;
    }

    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setInputValue(prev => prev + input);
    }

    if (key.delete || key.backspace) {
      setInputValue(prev => prev.slice(0, -1));
    }
  });

  if (!isReady) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%">
        <Text color="cyan">Starting StarUp AI Agent...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">StarUp AI Agent</Text>
        <Text color="gray">Skills:{status.skills} Tools:{status.tools}</Text>
      </Box>

      {/* Help */}
      {showHelp && (
        <Box marginY={1} borderStyle="double" borderColor="yellow" padding={1}>
          <Box flexDirection="column">
            <Text bold color="yellow">Help</Text>
            <Text>/help /exit /clear /status</Text>
            <Text>Enter: Send | Ctrl+C: Exit</Text>
          </Box>
        </Box>
      )}

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} padding={1}>
        {messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} />
        ))}
        {isProcessing && currentTool && (
          <Box marginY={1}>
            <Text color="yellow">Tool: {currentTool}...</Text>
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box borderStyle="single" borderColor={isProcessing ? "red" : "green"} paddingX={1}>
        <Box width="100%" justifyContent="space-between">
          <Box flexGrow={1}>
            <Text color="cyan">&gt; </Text>
            <Text>{inputValue}</Text>
            {!isProcessing && inputValue.length === 0 && (
              <Text color="gray"> Type message...</Text>
            )}
            {!isProcessing && <Text color="gray">_</Text>}
          </Box>
          
          {/* Button */}
          <Box marginLeft={2}>
            {isProcessing ? (
              <Text backgroundColor="red" color="white" bold> STOP </Text>
            ) : (
              <Text backgroundColor={inputValue.trim() ? "green" : "gray"} color="white" bold>
                {inputValue.trim() ? ' SEND ' : ' '}
              </Text>
            )}
          </Box>
        </Box>
      </Box>
      
      {isProcessing && (
        <Box justifyContent="center">
          <Text color="gray">Press Enter to stop</Text>
        </Box>
      )}
    </Box>
  );
};

// Message Item
const MessageItem: React.FC<{ message: Message }> = ({ message }) => {
  const time = new Date(message.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  switch (message.role) {
    case 'user':
      return (
        <Box justifyContent="flex-end" marginY={1}>
          <Box borderStyle="round" borderColor="blue" paddingX={1}>
            <Text>{message.content}</Text>
            <Text color="gray"> {time}</Text>
          </Box>
        </Box>
      );
    case 'assistant':
      return (
        <Box justifyContent="flex-start" marginY={1}>
          <Box borderStyle="round" borderColor="green" paddingX={1}>
            <Text bold color="green">AI </Text>
            <Text>{message.content || 'Thinking...'}</Text>
          </Box>
        </Box>
      );
    case 'system':
      return (
        <Box justifyContent="center" marginY={1}>
          <Text color="gray">{message.content}</Text>
        </Box>
      );
    default:
      return null;
  }
};

render(<App />);
