import { useState, useRef, useEffect, useMemo } from "react";
import { Copy, Check, ChevronUp, ChevronDown } from "lucide-react";
import { renderMarkdown, copyText } from "../utils/markdown";

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
function ThinkingMessage({ id, content, isStreaming }) {
  const [expanded, setExpanded] = useState(false);

  const displayContent =
    typeof content === "string" ? content.replace(/\n{3,}/g, "") : content;

  return (
    <section className="thinking-item" key={id}>
      {isStreaming && (
        <div className="thinking-dots">
          <span />
          <span />
          <span />
        </div>
      )}
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
        <div id={`thinking-${id}`} className="thinking-content">
          {displayContent}
        </div>
      ) : null}
    </section>
  );
}

/**
 * ToolCall 卡片组件（可折叠，支持滚轮）
 */
function ToolCallCard({ toolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      className={`tool-card status-${toolCall.status || "running"} ${expanded ? "expanded" : "collapsed"}`}
    >
      <button
        className="tool-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={`tool-${toolCall.id}`}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="tool-header">
          <span className="tool-title">{toolCall.title || "工具调用"}</span>
          <span className="tool-status">{toolCall.detail || "进行中..."}</span>
        </div>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded ? (
        <div id={`tool-${toolCall.id}`} className="tool-content">
          <div className="tool-path">{toolCall.content || "-"}</div>
        </div>
      ) : null}
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
function MessageList({
  allMessages,
  isStreaming,
  isThinking,
  scrollRef,
  onScrollChange,
  forceScrollToBottom,
}) {
  const userHasScrolledRef = useRef(false);
  const lastThinkingId = useMemo(() => {
    for (let i = allMessages.length - 1; i >= 0; i -= 1) {
      const item = allMessages[i];
      if (item.type === "message" && item.data?.role === "thinking") {
        return item.data.id;
      }
    }
    return null;
  }, [allMessages]);

  useEffect(() => {
    if (forceScrollToBottom) {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
        userHasScrolledRef.current = false;
      }
    }
  }, [forceScrollToBottom, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (userHasScrolledRef.current) return;

    if (isStreaming) {
      el.scrollTop = el.scrollHeight;
    }
  }, [allMessages, isStreaming, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const isNearBottom =
        el.scrollHeight - (el.scrollTop + el.clientHeight) < 120;
      userHasScrolledRef.current = !isNearBottom;
      if (onScrollChange) {
        onScrollChange(!isNearBottom);
      }
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [scrollRef, onScrollChange]);

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
          if (item.data?.content === "" || item.data?.content === undefined) {
            return null;
          }

          if (item.type === "tool_call") {
            return <ToolCallCard key={item.data.id} toolCall={item.data} />;
          }

          if (item.type === "message") {
            const msg = item.data;

            if (msg.role === "user") {
              return <UserMessage key={msg.id} content={msg.content} />;
            }

            if (msg.role === "thinking") {
              return (
                <ThinkingMessage
                  key={msg.id}
                  id={msg.id}
                  content={msg.content}
                  isStreaming={
                    isStreaming && isThinking && msg.id === lastThinkingId
                  }
                />
              );
            }

            if (msg.role === "assistant") {
              const isLast = idx === allMessages.length - 1;
              return (
                <AssistantMessage
                  key={msg.id}
                  content={msg.content}
                  streaming={isStreaming && isLast}
                />
              );
            }
          }

          return null;
        })}
      </div>
    </div>
  );
}

export { AssistantMessage, ThinkingMessage, ToolCallCard, UserMessage };
export default MessageList;
