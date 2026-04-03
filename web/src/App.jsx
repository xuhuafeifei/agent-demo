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
import Sidebar, { SIDEBAR_KEY, navItems } from "./components/Sidebar";
import Header from "./components/Header";
import ContextSnapshotDock from "./components/ContextSnapshotDock";
import MessageList from "./components/MessageList";
import InputArea from "./components/InputArea";
import SettingsPage from "./components/SettingsPage";
import "./styles.css";

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
  const scrollRef = useRef(null);

  const getAllMessages = useChatStore((state) => state.getAllMessages);
  const allMessages = getAllMessages();

  const isStreaming = useChatStore((state) => state.isStreaming);
  const isThinking = useChatStore((state) => state.isThinking);
  const contextEvents = useChatStore((state) => state.contextEvents);
  const addUserMessage = useChatStore((state) => state.addUserMessage);
  const endStreaming = useChatStore((state) => state.endStreaming);

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
