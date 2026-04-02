import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare,
  ChartNoAxesCombined,
  FolderKanban,
  Zap,
  MessageCircleMore,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  Moon,
  Monitor,
  AtSign,
  Paperclip,
  ArrowUp,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Menu,
} from "lucide-react";
import { useChatStore } from "./store/chatStore";
import { useSSEChat } from "./hooks/useSSEChat";
import { renderMarkdown, copyText } from "./utils/markdown";
import "./styles.css";

const SIDEBAR_KEY = "agent_demo_sidebar_collapsed";
const DESKTOP_BREAKPOINT = 1024;
const MOBILE_BREAKPOINT = 768;

const navItems = [
  { key: "chat", label: "聊天", icon: MessageSquare },
  { key: "overview", label: "概览", icon: ChartNoAxesCombined },
  { key: "channel", label: "频道", icon: FolderKanban },
  { key: "instance", label: "实例", icon: Zap },
  { key: "session", label: "会话", icon: MessageCircleMore },
  { key: "setting", label: "设置", icon: Settings },
];

/**
 * 侧边栏组件
 */
function Sidebar({ collapsed, onToggle, activeNav, onSelectNav, isMobile, mobileOpen, onCloseMobile }) {
  const [tooltip, setTooltip] = useState({ show: false, text: "", x: 0, y: 0 });
  const tooltipTimerRef = useRef(null);

  const wrapperClass = isMobile
    ? `mobile-sidebar ${mobileOpen ? "open" : ""}`
    : `sidebar ${collapsed ? "collapsed" : ""}`;

  return (
    <>
      {isMobile && mobileOpen ? <div className="mobile-mask" onClick={onCloseMobile} /> : null}
      <aside className={wrapperClass} aria-label="主导航">
        <div className="sidebar-head">
          <div className="brand-wrap">
            <div className="brand-logo">A</div>
            {!collapsed ? <div className="brand-title">Agent Demo</div> : null}
          </div>
          {!isMobile ? (
            <button className="icon-btn" onClick={onToggle} aria-label="切换侧边栏" type="button">
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          ) : null}
        </div>

        <nav className="sidebar-nav" role="navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.key;
            return (
              <button
                key={item.key}
                className={`nav-item ${active ? "active" : ""}`}
                type="button"
                onClick={() => {
                  onSelectNav(item.key);
                  if (isMobile) onCloseMobile();
                }}
                onMouseEnter={(event) => {
                  if (isMobile || !collapsed) return;
                  window.clearTimeout(tooltipTimerRef.current);
                  tooltipTimerRef.current = window.setTimeout(() => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setTooltip({
                      show: true,
                      text: item.label,
                      x: rect.right + 8,
                      y: rect.top + rect.height / 2,
                    });
                  }, 200);
                }}
                onMouseLeave={() => {
                  window.clearTimeout(tooltipTimerRef.current);
                  setTooltip((prev) => ({ ...prev, show: false }));
                }}
              >
                <Icon size={18} />
                {!collapsed ? <span className="nav-label">{item.label}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          {!collapsed ? <span className="version">v1.0.0</span> : null}
          <span className="online-dot" aria-hidden="true" />
        </div>

        {!isMobile && collapsed && tooltip.show ? (
          <div className="nav-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            <span>{tooltip.text}</span>
            <i />
          </div>
        ) : null}
      </aside>
    </>
  );
}

/**
 * 顶部栏组件
 */
function Header({ isMobile, onOpenMobile }) {
  return (
    <header className="header-bar">
      <div className="header-left">
        {isMobile ? (
          <button className="icon-btn" type="button" aria-label="打开菜单" onClick={onOpenMobile}>
            <Menu size={16} />
          </button>
        ) : null}
        <div className="breadcrumbs">
          <span>Agent Demo</span>
          <span className="sep">›</span>
          <span>聊天</span>
        </div>
      </div>

      <div className="header-right">
        <button className="search-btn" type="button">
          <span className="search-left">
            <Search size={14} />
            <span>搜索</span>
          </span>
          <kbd>⌘K</kbd>
        </button>
        <button className="icon-btn" type="button" aria-label="浅色模式">
          <Sun size={16} />
        </button>
        <button className="icon-btn" type="button" aria-label="深色模式">
          <Moon size={16} />
        </button>
        <button className="icon-btn" type="button" aria-label="系统模式">
          <Monitor size={16} />
        </button>
      </div>
    </header>
  );
}

/**
 * Assistant 消息组件（无边框设计）
 */
function AssistantMessage({ content, streaming }) {
  const [copied, setCopied] = useState(false);

  return (
    <article className="message assistant">
      <div className="llm-response">
        <div
          className={`llm-content ${streaming ? "streaming" : ""}`}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
        <div className="copy-wrap">
          <button
            className={`copy-btn ${copied ? "copied" : ""}`}
            type="button"
            aria-label="复制内容"
            onClick={async () => {
              const ok = await copyText(content);
              if (!ok) return;
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * Thinking 消息组件（可折叠）
 */
function ThinkingMessage({ id, content }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="thinking-item" key={id}>
      <button
        className="thinking-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={`thinking-${id}`}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span>Thinking</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded ? (
        <div
          id={`thinking-${id}`}
          className="thinking-content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      ) : null}
    </section>
  );
}

/**
 * ToolCall 卡片组件
 */
function ToolCallCard({ toolCall }) {
  return (
    <section className={`tool-card status-${toolCall.status || "running"}`}>
      <div className="tool-content">
        <div className="tool-title">{toolCall.title || "工具调用"}</div>
        <div className="tool-path">{toolCall.content || "-"}</div>
        <div className="tool-status">{toolCall.detail || "进行中..."}</div>
      </div>
    </section>
  );
}

/**
 * 用户消息组件
 */
function UserMessage({ content }) {
  return (
    <article className="message user">
      <div className="user-bubble">{content}</div>
    </article>
  );
}

/**
 * 消息列表组件 - VSCode 方式：按时间戳排序渲染
 */
function MessageList({ allMessages, isStreaming }) {
  const scrollRef = useRef(null);
  const userHasScrolledRef = useRef(false);

  // 自动滚动到底部（仅在用户没有手动滚动时）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (userHasScrolledRef.current) return;

    if (isStreaming) {
      el.scrollTop = el.scrollHeight;
    }
  }, [allMessages, isStreaming]);

  // 监听用户滚动
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const isNearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 120;
      userHasScrolledRef.current = !isNearBottom;
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="chat-scroll" ref={scrollRef}>
      <div className="chat-thread">
        {!allMessages.length ? (
          <div className="empty-state" role="status" aria-live="polite">
            <div className="empty-icon">💬</div>
            <p>开始新的对话吧</p>
            <p>输入问题或@引用内容</p>
          </div>
        ) : null}

        {allMessages.map((item, idx) => {
          if (item.type === "tool_call") {
            return <ToolCallCard key={item.data.id} toolCall={item.data} />;
          }

          if (item.type === "message") {
            const msg = item.data;

            if (msg.role === "user") {
              return <UserMessage key={msg.id} content={msg.content} />;
            }

            if (msg.role === "thinking") {
              return <ThinkingMessage key={msg.id} id={msg.id} content={msg.content} />;
            }

            if (msg.role === "assistant") {
              const isLast = idx === allMessages.length - 1;
              return <AssistantMessage key={msg.id} content={msg.content} streaming={isStreaming && isLast} />;
            }
          }

          return null;
        })}
      </div>
    </div>
  );
}

/**
 * 底部输入框组件
 */
function InputArea({ onSend }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);
  const isStreaming = useChatStore((state) => state.isStreaming);

  const canSend = value.trim().length > 0 && !isStreaming;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <section className="input-wrap">
      <div className="input-card">
        <textarea
          ref={textareaRef}
          className="input-textarea"
          rows={1}
          value={value}
          placeholder="继续提问，或输入 @ 来引用内容"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && canSend) {
              e.preventDefault();
              const text = value.trim();
              setValue("");
              onSend(text);
            }
          }}
        />

        <div className="input-actions">
          <div className="left-tools">
            <button className="tool-btn" type="button" aria-label="提及">
              <AtSign size={18} />
            </button>
            <button className="tool-btn" type="button" aria-label="上传附件">
              <Paperclip size={18} />
            </button>
          </div>
          <div className="right-tools">
            <button className="model-btn" type="button" aria-label="模型选择">
              <Settings size={14} />
              <span>最佳</span>
            </button>
            <button
              className={`send-btn ${canSend ? "active" : "disabled"}`}
              type="button"
              aria-label="发送消息"
              disabled={!canSend}
              onClick={() => {
                const text = value.trim();
                if (!text) return;
                setValue("");
                onSend(text);
              }}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
      <p className="input-hint">内容由 AI 生成仅供参考</p>
    </section>
  );
}

/**
 * 主应用组件
 */
export default function App() {
  const [activeNav, setActiveNav] = useState("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  // VSCode 方式：获取排序后的所有消息
  const getAllMessages = useChatStore((state) => state.getAllMessages);
  const allMessages = getAllMessages();

  const isStreaming = useChatStore((state) => state.isStreaming);
  const addUserMessage = useChatStore((state) => state.addUserMessage);
  const endStreaming = useChatStore((state) => state.endStreaming);

  const { sendMessage } = useSSEChat();

  const isMobile = viewportWidth < MOBILE_BREAKPOINT;

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
        />

        <div className="main-shell">
          <Header isMobile={isMobile} onOpenMobile={() => setMobileOpen(true)} />
          <main className="chat-main">
            <MessageList allMessages={allMessages} isStreaming={isStreaming} />
            <InputArea
              onSend={async (text) => {
                addUserMessage(text);
                try {
                  await sendMessage(text);
                } catch (error) {
                  console.error(error);
                  endStreaming();
                }
              }}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
