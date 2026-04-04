/**
 * Modern CLI UI - 基于 Ink 的现代化终端界面
 * 提供美观、可打断的交互体验
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { render, Box, Text, useInput, useApp, Spacer } from 'ink';
import { StarUpCore, ProcessMessageCallbacks } from '../index';
import { logger } from '../utils/Logger';

// 组件导入
import { Header } from './components/Header';
import { MessageList } from './components/MessageList';
import { InputBox } from './components/InputBox';
import { StatusBar } from './components/StatusBar';
import { ThinkingIndicator } from './components/ThinkingIndicator';
import { ToolCallDisplay } from './components/ToolCallDisplay';

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

interface ModernCLIProps {
  core?: StarUpCore;
}

/**
 * ModernCLI 主组件
 */
const ModernCLI: React.FC<ModernCLIProps> = ({ core: propCore }) => {
  const { exit } = useApp();
  const [core, setCore] = useState<StarUpCore | null>(propCore || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState({ skills: 0, tools: 0 });
  const [interruptFlag, setInterruptFlag] = useState(false);
  
  const scrollRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 初始化
  useEffect(() => {
    const init = async () => {
      try {
        const newCore = propCore || new StarUpCore();
        if (!propCore) {
          await newCore.initialize();
        }
        setCore(newCore);

        // 创建主会话
        const mainSession = newCore.sessionManager.initializeMainSession();
        setSessionId(mainSession.id);

        // 注册会话到持久化系统
        newCore.registerSession(mainSession.id);

        // 获取状态
        setStatus(newCore.getStatus());

        // 添加欢迎消息
        addMessage({
          id: Date.now().toString(),
          role: 'system',
          content: 'StarUp AI Agent 已启动。输入 /help 查看帮助。',
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error('ModernCLI', `Initialization failed: ${error}`);
        exit();
      }
    };

    init();

    return () => {
      // 清理
      if (core && sessionId) {
        core.unregisterSession(sessionId);
      }
    };
  }, []);

  // 添加消息
  const addMessage = useCallback((message: Message) => {
    setMessages(prev => [...prev, message]);
  }, []);

  // 更新消息内容（用于流式输出）
  const updateLastMessage = useCallback((content: string) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant') {
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + content },
        ];
      }
      return prev;
    });
  }, []);

  // 处理用户输入
  const handleSubmit = useCallback(async () => {
    if (!inputValue.trim() || !core || !sessionId || isThinking) return;

    const userMessage = inputValue.trim();
    setInputValue('');

    // 添加用户消息
    addMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // 处理命令
    if (userMessage.startsWith('/')) {
      await handleCommand(userMessage);
      return;
    }

    // 处理 AI 请求
    setIsThinking(true);
    setInterruptFlag(false);

    // 创建中止控制器
    abortControllerRef.current = new AbortController();

    // 添加 AI 消息占位
    const aiMessageId = `ai-${Date.now()}`;
    addMessage({
      id: aiMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      metadata: { thinking: true },
    });

    const callbacks: ProcessMessageCallbacks = {
      onThinking: (content) => {
        // 可以在这里显示思考过程
      },
      onToolCall: (name, args) => {
        setCurrentTool(name);
        addMessage({
          id: `tool-${Date.now()}`,
          role: 'tool',
          content: `调用工具: ${name}`,
          timestamp: Date.now(),
          metadata: { toolName: name },
        });
      },
      onToolResult: (name, result) => {
        setCurrentTool(null);
        addMessage({
          id: `tool-result-${Date.now()}`,
          role: 'tool',
          content: result.success ? '✓ 完成' : `✗ 失败: ${result.error}`,
          timestamp: Date.now(),
          metadata: { toolName: name, toolResult: result },
        });
      },
      onStreamChunk: (chunk) => {
        if (!interruptFlag) {
          setIsStreaming(true);
          updateLastMessage(chunk);
        }
      },
    };

    try {
      const result = await core.processMessage(sessionId, userMessage, callbacks);
      
      // 如果被打断，添加提示
      if (interruptFlag) {
        updateLastMessage('\n\n[用户打断]');
      }
    } catch (error) {
      addMessage({
        id: `error-${Date.now()}`,
        role: 'system',
        content: `错误: ${error}`,
        timestamp: Date.now(),
      });
    } finally {
      setIsThinking(false);
      setIsStreaming(false);
      setCurrentTool(null);
      abortControllerRef.current = null;
    }
  }, [inputValue, core, sessionId, isThinking, interruptFlag, addMessage, updateLastMessage]);

  // 处理命令
  const handleCommand = async (command: string) => {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0];

    switch (cmd) {
      case 'help':
        addMessage({
          id: `cmd-${Date.now()}`,
          role: 'system',
          content: `可用命令:
/help - 显示帮助
/exit, /quit - 退出
/clear - 清空屏幕
/status - 显示系统状态
/tools - 列出可用工具
/skills - 列出已加载的 Skills`,
          timestamp: Date.now(),
        });
        break;

      case 'exit':
      case 'quit':
        if (core && sessionId) {
          await core.unregisterSession(sessionId);
        }
        exit();
        break;

      case 'clear':
        setMessages([]);
        break;

      case 'status':
        if (core) {
          const stats = core.sessionManager.getStats();
          addMessage({
            id: `cmd-${Date.now()}`,
            role: 'system',
            content: `系统状态:
Skills: ${status.skills}
工具: ${status.tools}
会话: ${stats.total} (活跃: ${stats.active}, 子代理: ${stats.subAgents})`,
            timestamp: Date.now(),
          });
        }
        break;

      case 'tools':
        if (core) {
          const tools = core.toolRegistry.getAll();
          const toolList = tools.map(t => `- ${t.name}: ${t.description.substring(0, 50)}...`).join('\n');
          addMessage({
            id: `cmd-${Date.now()}`,
            role: 'system',
            content: `可用工具:\n${toolList}`,
            timestamp: Date.now(),
          });
        }
        break;

      case 'skills':
        if (core) {
          const skills = core.skillRegistry.list();
          const skillList = [...skills.user, ...skills.packages.map(p => ({ metadata: p.manifest }))]
            .map(s => `- ${s.metadata.name}: ${s.metadata.description?.substring(0, 50)}...`)
            .join('\n');
          addMessage({
            id: `cmd-${Date.now()}`,
            role: 'system',
            content: `已加载 Skills:\n${skillList}`,
            timestamp: Date.now(),
          });
        }
        break;

      default:
        addMessage({
          id: `cmd-${Date.now()}`,
          role: 'system',
          content: `未知命令: ${cmd}`,
          timestamp: Date.now(),
        });
    }

    setIsThinking(false);
  };

  // 键盘处理
  useInput((input, key) => {
    // Ctrl+C 打断
    if (key.ctrl && key.return) {
      if (isThinking || isStreaming) {
        setInterruptFlag(true);
        abortControllerRef.current?.abort();
        addMessage({
          id: `interrupt-${Date.now()}`,
          role: 'system',
          content: '[打断]',
          timestamp: Date.now(),
        });
      }
      return;
    }

    // Enter 提交
    if (key.return) {
      handleSubmit();
      return;
    }

    // 普通字符输入
    if (!key.ctrl && !key.meta && input) {
      setInputValue(prev => prev + input);
    }

    // Backspace
    if (key.delete || key.backspace) {
      setInputValue(prev => prev.slice(0, -1));
    }

    // Ctrl+C 退出
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Header title="StarUp AI Agent" version="2.0.0" />
      
      <Box flexDirection="column" flexGrow={1} padding={1}>
        <MessageList 
          messages={messages} 
          scrollOffset={scrollRef.current}
        />
      </Box>

      {isThinking && (
        <ThinkingIndicator 
          toolName={currentTool} 
          interruptible={isStreaming}
        />
      )}

      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="cyan">{'>'}</Text>
        <Text> {inputValue}</Text>
        <Text color="gray">_</Text>
      </Box>

      <StatusBar 
        skills={status.skills}
        tools={status.tools}
        sessionId={sessionId}
        isProcessing={isThinking}
      />
    </Box>
  );
};

// 渲染入口
export function startModernCLI(core?: StarUpCore) {
  render(<ModernCLI core={core} />);
}

export default ModernCLI;
