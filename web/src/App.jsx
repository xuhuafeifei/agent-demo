import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare,
  ChartNoAxesCombined,
  FolderKanban,
  Zap,
  MessageCircleMore,
  Settings,
} from "lucide-react";
import { useChatStore } from "./store/chatStore";
import { useSSEChat } from "./hooks/useSSEChat";
import { getHistory, clearHistory } from "./api/configApi";
import Sidebar, { SIDEBAR_KEY, navItems } from "./components/Sidebar";
import Header from "./components/Header";
import ContextSnapshotDock from "./components/ContextSnapshotDock";
import MessageList from "./components/MessageList";
import InputArea from "./components/InputArea";
import SettingsPage from "./components/SettingsPage";
import { MessageContainer } from "./components/Message";
import "./styles.css";
import "./styles/message.css";

// Attach icons to navItems
navItems[0].icon = MessageSquare;
navItems[1].icon = ChartNoAxesCombined;
navItems[2].icon = FolderKanban;
navItems[3].icon = Zap;
navItems[4].icon = MessageCircleMore;
navItems[5].icon = Settings;

const DESKTOP_BREAKPOINT = 1024;
const MOBILE_BREAKPOINT = 768;

/**
 * 主应用组件
 */
export default function App() {
  const [activeNav, setActiveNav] = useState("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [forceScrollToBottom, setForceScrollToBottom] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const scrollRef = useRef(null);

  const getAllMessages = useChatStore((state) => state.getAllMessages);
  const allMessages = getAllMessages();

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

  const handleSendMessage = async (text) => {
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
    const saved = window.localStorage.getItem(SIDEBAR_KEY) === "1";
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
        const response = await getHistory();
        if (!mounted || !response.success) return;

        const history = response.history || [];
        // 清空当前消息
        clearMessages();

        // 将历史消息按顺序添加到 chatStore
        history.forEach((item, index) => {
          const ts =
            typeof item.timestamp === "number"
              ? item.timestamp
              : Date.now() - (history.length - index) * 1000;

          if (item.role === "user") {
            const content =
              typeof item.content === "string"
                ? item.content
                : JSON.stringify(item.content || "");
            addUserMessage(content, ts);
          } else if (item.role === "assistant") {
            const content =
              typeof item.content === "string"
                ? item.content
                : JSON.stringify(item.content || "");
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
        console.error("Failed to load history:", error);
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
        setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "1");
      }
      if (window.innerWidth >= MOBILE_BREAKPOINT) {
        setMobileOpen(false);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.querySelector(".input-textarea")?.focus();
      }
      if (e.key === "Escape") {
        setMobileOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const shellClassName = useMemo(() => {
    if (isMobile) return "shell mobile";
    return `shell ${collapsed ? "sidebar-collapsed" : ""}`;
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
            window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
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
            {activeNav === "setting" ? (
              <SettingsPage />
            ) : (
              <>
                {activeNav === "chat" ? (
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
