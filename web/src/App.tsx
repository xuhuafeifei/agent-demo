import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare,
  ChartNoAxesCombined,
  FolderKanban,
  Zap,
  MessageCircleMore,
  Settings,
  CalendarClock,
} from 'lucide-react';
import { useChatStore } from './store/chatStore';
import { useSSEChat } from './hooks/useSSEChat';
import { getHistory } from './api/client';
import Sidebar, { SIDEBAR_KEY, navItems, type NavItem } from './components/Sidebar';
import Header from './components/Header';
import ContextSnapshotDock from './components/ContextSnapshotDock';
import MessageList from './components/MessageList';
import InputArea from './components/InputArea';
import SettingsPage from './components/SettingsPage';
import TaskSchedulePage from './components/TaskSchedulePage';
import { MessageContainer } from './components/Message';
import type { WrappedMessage } from './types';
import './styles.css';
import './styles/message.css';

// Attach icons to navItems
(navItems[0] as any).icon = MessageSquare;
(navItems[1] as any).icon = ChartNoAxesCombined;
(navItems[2] as any).icon = FolderKanban;
(navItems[3] as any).icon = Zap;
(navItems[4] as any).icon = MessageCircleMore;
(navItems[5] as any).icon = CalendarClock;
(navItems[6] as any).icon = Settings;

const DESKTOP_BREAKPOINT = 1024;
const MOBILE_BREAKPOINT = 768;

/**
 * 主应用组件
 */
export default function App() {
  const [activeNav, setActiveNav] = useState('chat');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [forceScrollToBottom, setForceScrollToBottom] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 从 store 获取原始数据（使用稳定引用）
  const messages = useChatStore((state) => state.messages);
  const toolCalls = useChatStore((state) => state.toolCalls);
  const permissionRequests = useChatStore((state) => state.permissionRequests);

  // 使用 useMemo 合并和排序，避免每次渲染创建新数组
  const allMessages: WrappedMessage[] = useMemo(() => {
    const regularMessages: WrappedMessage[] = messages.map((msg) => ({
      type: 'message' as const,
      data: msg,
      timestamp: msg.timestamp,
    }));

    const toolCallMessages: WrappedMessage[] = toolCalls.map((tool) => ({
      type: 'tool_call' as const,
      data: tool,
      timestamp: tool.timestamp,
    }));

    const permissionMessages: WrappedMessage[] = permissionRequests.map(
      (p) => ({
        type: 'permission_request' as const,
        data: p,
        timestamp: p.timestamp,
      })
    );

    return [
      ...regularMessages,
      ...toolCallMessages,
      ...permissionMessages,
    ].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }, [messages, toolCalls, permissionRequests]);

  const isStreaming = useChatStore((state) => state.isStreaming);
  const isThinking = useChatStore((state) => state.isThinking);
  const contextEvents = useChatStore((state) => state.contextEvents);
  const addUserMessage = useChatStore((state) => state.addUserMessage);
  const endStreaming = useChatStore((state) => state.endStreaming);
  const clearMessages = useChatStore((state) => state.clearMessages);
  const addContextSnapshot = useChatStore((state) => state.addContextSnapshot);
  const addContextUsed = useChatStore((state) => state.addContextUsed);
  const startStreaming = useChatStore((state) => state.startStreaming);
  const appendStreamChunk = useChatStore((state) => state.appendStreamChunk);

  const { sendMessage } = useSSEChat();

  const isMobile = viewportWidth < MOBILE_BREAKPOINT;

  const handleSendMessage = async (text: string) => {
    addUserMessage(text);
    setForceScrollToBottom(true);
    try {
      await sendMessage(text);
    } catch (error) {
      console.error(error);
      endStreaming();
    }
    setForceScrollToBottom(false);
  };

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_KEY) === '1';
    if (window.innerWidth < DESKTOP_BREAKPOINT) {
      setCollapsed(true);
    } else {
      setCollapsed(saved);
    }
  }, []);

  // 加载历史消息
  useEffect(() => {
    let mounted = true;
    async function loadHistory() {
      setIsLoadingHistory(true);
      try {
        const response = await getHistory() as any;
        if (!mounted || !response.success) return;

        const history = response.history || [];
        // 清空当前消息
        clearMessages();

        // 将历史消息按顺序添加到 chatStore
        history.forEach((item, index) => {
          const ts =
            typeof item.timestamp === 'number'
              ? item.timestamp
              : Date.now() - (history.length - index) * 1000;

          if (item.role === 'user') {
            const content =
              typeof item.content === 'string'
                ? item.content
                : JSON.stringify(item.content || '');
            addUserMessage(content, ts);
          } else if (item.role === 'assistant') {
            const content =
              typeof item.content === 'string'
                ? item.content
                : JSON.stringify(item.content || '');
            startStreaming(ts);
            appendStreamChunk(content, ts);
            endStreaming();
          }
        });

        setHistoryLoaded(true);
        // 历史加载完成后滚动到底部
        if (mounted && history.length > 0) {
          setTimeout(() => {
            setForceScrollToBottom(true);
            setTimeout(() => setForceScrollToBottom(false), 100);
          }, 50);
        }
      } catch (error) {
        console.error('Failed to load history:', error);
      } finally {
        if (mounted) {
          setIsLoadingHistory(false);
        }
      }
    }
    loadHistory();
    return () => {
      mounted = false;
    };
  }, []); // 只加载一次，移除 historyLoaded 依赖

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      if (window.innerWidth < DESKTOP_BREAKPOINT) {
        setCollapsed(true);
      } else {
        setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === '1');
      }
      if (window.innerWidth >= MOBILE_BREAKPOINT) {
        setMobileOpen(false);
      }
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const el = document.querySelector('.input-textarea') as HTMLTextAreaElement | null;
        el?.focus();
      }
      if (e.key === 'Escape') {
        setMobileOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const shellClassName = useMemo(() => {
    if (isMobile) return 'shell mobile';
    return `shell ${collapsed ? 'sidebar-collapsed' : ''}`;
  }, [collapsed, isMobile]);

  return (
    <div className="app-bg">
      {/* Global Message Container */}
      <MessageContainer />

      <div className={shellClassName}>
        <Sidebar
          collapsed={collapsed}
          onToggle={() => {
            const next = !collapsed;
            setCollapsed(next);
            window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
          }}
          activeNav={activeNav}
          onSelectNav={setActiveNav}
          isMobile={isMobile}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          navItems={navItems}
        />

        <div className="main-shell">
          <Header
            isMobile={isMobile}
            onOpenMobile={() => setMobileOpen(true)}
          />
          <main className="chat-main">
            {activeNav === 'setting' ? (
              <SettingsPage />
            ) : activeNav === 'tasks' ? (
              <TaskSchedulePage />
            ) : (
              <>
                {activeNav === 'chat' ? (
                  <ContextSnapshotDock contextEvents={contextEvents} />
                ) : null}
                <MessageList
                  allMessages={allMessages}
                  isStreaming={isStreaming}
                  isThinking={isThinking}
                  scrollRef={scrollRef}
                  onScrollChange={setShowScrollButton}
                  forceScrollToBottom={forceScrollToBottom}
                  isLoadingHistory={isLoadingHistory}
                />
                <InputArea
                  onSend={handleSendMessage}
                  scrollRef={scrollRef}
                  showScrollButton={showScrollButton}
                />
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
