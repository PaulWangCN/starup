#!/usr/bin/env node
/**
 * StarUp AI Agent - Ink UI 入口
 */

import { setupGlobalErrorHandling, CrashLogger } from '../utils/CrashLogger.js';
setupGlobalErrorHandling();

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const loadCore = async () => require('../../dist/index.js');

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
}

// 加载 system prompt 的辅助函数
async function loadSystemPrompt(core: any): Promise<string> {
  try {
    const fs = require('fs/promises');
    const path = require('path');
    
    const promptFiles = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md'];
    const agentPath = path.join(process.cwd(), '.starup');
    
    const contents: string[] = [];
    for (const filename of promptFiles) {
      const filePath = path.join(agentPath, filename);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        contents.push(`=== ${filename} ===\n${content}`);
      } catch (e) {
        // 文件不存在，跳过
      }
    }
    
    // 添加工具信息
    const toolRegistry = core.toolRegistry;
    const tools = toolRegistry ? toolRegistry.getAll() : [];
    const toolDescriptions = tools.map((t: any) => `- ${t.name}: ${t.description}`).join('\n');
    
    if (toolDescriptions) {
      contents.push(`=== 可用工具 ===\n${toolDescriptions}`);
    }
    
    return contents.join('\n\n');
  } catch (error) {
    console.error('Failed to load system prompt:', error);
    return '你是 StarUp AI，一个专业的 AI 助手。';
  }
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

  // 初始化 core
  useEffect(() => {
    const init = async () => {
      try {
        const coreModule = await loadCore();
        const StarUpCore = coreModule.StarUpCore;
        const newCore = new StarUpCore();
        await newCore.initialize();
        setCore(newCore);

        // 加载 system prompt
        const systemPrompt = await loadSystemPrompt(newCore);
        
        // 初始化会话时传入 system prompt
        const mainSession = newCore.sessionManager.initializeMainSession(systemPrompt);
        setSessionId(mainSession.id);
        newCore.registerSession(mainSession.id);

        setStatus(newCore.getStatus());
        setIsReady(true);

        addMessage({
          id: `welcome-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'system',
          content: 'StarUp AI Agent Started\nType /help for help, Ctrl+C to exit',
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error('Init error:', error);
        setIsReady(true);
      }
    };

    init();
  }, []);

  const addMessage = useCallback((message: Message) => {
    setMessages(prev => [...prev, message]);
  }, []);

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

  const handleSubmit = useCallback(async () => {
    if (!inputValue.trim() || !core || !sessionId || isProcessing) return;

    const text = inputValue.trim();
    setInputValue('');

    if (text.startsWith('/')) {
      await handleCommand(text);
      return;
    }

    addMessage({
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });

    const controller = new AbortController();
    setAbortController(controller);
    setIsProcessing(true);
    setCurrentTool(null);

    addMessage({
      id: `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
          id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
          id: `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'system',
          content: `Skills: ${status.skills} | Tools: ${status.tools}`,
          timestamp: Date.now(),
        });
        break;
      default:
        addMessage({
          id: `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'system',
          content: `Unknown: ${cmd}`,
          timestamp: Date.now(),
        });
    }
  };

  const handleStop = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsProcessing(false);
      addMessage({
        id: `stop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'system',
        content: 'Stopped',
        timestamp: Date.now(),
      });
    }
  }, [abortController]);

  useInput((input, key) => {
    // 只处理真正的 Ctrl+C，忽略其他情况
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (key.return) {
      if (isProcessing) {
        handleStop();
      } else {
        handleSubmit();
      }
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
      <Box borderStyle="single" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">StarUp AI Agent</Text>
        <Text color="gray">Skills:{status.skills} Tools:{status.tools}</Text>
      </Box>

      {showHelp && (
        <Box marginY={1} borderStyle="double" borderColor="yellow" padding={1}>
          <Box flexDirection="column">
            <Text bold color="yellow">Help</Text>
            <Text>/help /exit /clear /status</Text>
            <Text>Enter: Send | Ctrl+C: Exit</Text>
          </Box>
        </Box>
      )}

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
