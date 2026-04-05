import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Copy, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { renderMarkdown, copyText } from '../utils/markdown';
import type {
  Message,
  ToolCall,
  WrappedMessage,
  PermissionTimelineItem,
} from '@/types';
import type { RefObject } from 'react';
import { useChatStore } from '../store/chatStore';
import { api } from '../api/client';

export type { WrappedMessage };

/**
 * MessageList 组件 props
 */
interface MessageListProps {
  allMessages: WrappedMessage[];
  isStreaming: boolean;
  isThinking: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScrollChange?: (show: boolean) => void;
  forceScrollToBottom: boolean;
  isLoadingHistory: boolean;
}

/**
 * Assistant 消息组件（无边框设计）
 */
function AssistantMessage({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <article className="message assistant">
      <div className="llm-response">
        <div
          className={`llm-content ${streaming ? 'streaming' : ''}`}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
        <div className="copy-wrap">
          <button
            className={`copy-btn ${copied ? 'copied' : ''}`}
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
function ThinkingMessage({
  id,
  content,
  isStreaming,
}: {
  id: string;
  content: string;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const displayContent =
    typeof content === 'string' ? content.replace(/\n{3,}/g, '\n\n') : content;

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
function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      className={`tool-card status-${toolCall.status || 'running'} ${expanded ? 'expanded' : 'collapsed'}`}
    >
      <button
        className="tool-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={`tool-${toolCall.id}`}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="tool-header">
          <span className="tool-title">{toolCall.title || '工具调用'}</span>
          <span className="tool-status">{toolCall.detail || '进行中...'}</span>
        </div>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded ? (
        <div id={`tool-${toolCall.id}`} className="tool-content">
          <div className="tool-path">{toolCall.content || '-'}</div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * 用户消息组件
 */
function UserMessage({ content }: { content: string }) {
  return (
    <article className="message user">
      <div className="user-bubble">{content}</div>
    </article>
  );
}

function PermissionRequestCard({ item }: { item: PermissionTimelineItem }) {
  const updatePermissionRequestStatus = useChatStore(
    (s) => s.updatePermissionRequestStatus
  );
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const respond = useCallback(
    async (approved: boolean) => {
      if (item.status !== 'pending') return;
      setLoading(true);
      setError(null);
      const res = await api.approval.respond(item.toolUseId, approved);
      setLoading(false);
      if (!res.success) {
        setError(res.error || '操作失败');
        return;
      }
      updatePermissionRequestStatus(
        item.toolUseId,
        approved ? 'approved' : 'denied'
      );
    },
    [item.status, item.toolUseId, updatePermissionRequestStatus]
  );

  const statusLabel =
    item.status === 'pending'
      ? '等待确认'
      : item.status === 'approved'
        ? '已允许'
        : item.status === 'denied'
          ? '已拒绝'
          : '已过期（未操作或会话已结束）';

  return (
    <section
      className={`permission-card status-${item.status} ${expanded ? 'expanded' : 'collapsed'}`}
    >
      <button
        className="permission-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={`permission-${item.id}`}
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="permission-header">
          <span className="permission-title">工具审批</span>
          <code className="permission-tool-name">{item.toolName}</code>
          <span className="permission-status">{statusLabel}</span>
        </div>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded ? (
        <div id={`permission-${item.id}`} className="permission-content">
          <pre className="permission-args">
            {JSON.stringify(item.args, null, 2)}
          </pre>
        </div>
      ) : null}
      {item.status === 'pending' ? (
        <div className="permission-actions">
          <button
            type="button"
            className="permission-btn permission-btn-allow"
            disabled={loading}
            onClick={() => respond(true)}
          >
            {loading ? '处理中…' : '允许'}
          </button>
          <button
            type="button"
            className="permission-btn permission-btn-deny"
            disabled={loading}
            onClick={() => respond(false)}
          >
            {loading ? '处理中…' : '拒绝'}
          </button>
        </div>
      ) : null}
      {error ? <p className="permission-error">{error}</p> : null}
      {item.status === 'pending' ? (
        <p className="permission-hint">5 分钟内未操作将自动拒绝</p>
      ) : null}
    </section>
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
  isLoadingHistory,
}: MessageListProps) {
  const userHasScrolledRef = useRef(false);
  const lastThinkingId = useMemo(() => {
    for (let i = allMessages.length - 1; i >= 0; i -= 1) {
      const item = allMessages[i];
      if (item.type !== 'message') continue;
      const msg = item.data as Message;
      if (msg.role === 'thinking') return msg.id;
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

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [scrollRef, onScrollChange]);

  return (
    <div className="chat-scroll" ref={scrollRef}>
      <div className="chat-thread">
        {/* 只在非加载状态下且无消息时显示空状态 */}
        {!allMessages.length && !isLoadingHistory ? (
          <div className="empty-state" role="status" aria-live="polite">
            <div className="empty-icon">💬</div>
            <p>开始新的对话吧</p>
            <p>输入问题或@引用内容</p>
          </div>
        ) : null}

        {allMessages.map((item, idx) => {
          if (item.type === 'permission_request') {
            return (
              <PermissionRequestCard
                key={item.data.id}
                item={item.data}
              />
            );
          }

          if (item.type === 'tool_call') {
            return (
              <ToolCallCard
                key={(item.data as ToolCall).id}
                toolCall={item.data as ToolCall}
              />
            );
          }

          if (item.type === 'message') {
            const msg = item.data as Message;

            if (msg.content === '' || msg.content === undefined) {
              return null;
            }

            if (msg.role === 'user') {
              const content =
                typeof msg.content === 'string'
                  ? msg.content
                  : JSON.stringify(msg.content || '');
              return <UserMessage key={msg.id} content={content} />;
            }

            if (msg.role === 'thinking') {
              const content =
                typeof msg.content === 'string'
                  ? msg.content
                  : JSON.stringify(msg.content || '');
              return (
                <ThinkingMessage
                  key={msg.id}
                  id={msg.id}
                  content={content}
                  isStreaming={isStreaming && isThinking && msg.id === lastThinkingId}
                />
              );
            }

            if (msg.role === 'assistant') {
              const isLast = idx === allMessages.length - 1;
              const content =
                typeof msg.content === 'string'
                  ? msg.content
                  : JSON.stringify(msg.content || '');
              return (
                <AssistantMessage
                  key={msg.id}
                  content={content}
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

export {
  AssistantMessage,
  ThinkingMessage,
  ToolCallCard,
  UserMessage,
  PermissionRequestCard,
};
export default MessageList;
