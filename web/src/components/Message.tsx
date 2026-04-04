import { useState, useEffect, useCallback } from 'react';
import { Check, X, AlertCircle } from 'lucide-react';
import type { ComponentType } from 'react';

interface MessageItem {
  id: number;
  type: 'success' | 'error' | 'warning' | 'info';
  content: string;
  duration?: number;
}

const messages: MessageItem[] = [];
let listeners: Array<(msgs: MessageItem[]) => void> = [];

/**
 * 全局 Message 管理器（类似 Element Plus 的 ElMessage）
 */
const MessageManager = {
  add(msg: Omit<MessageItem, 'id'>): number {
    const id = Date.now() + Math.random();
    const newMsg = { id, ...msg };
    messages.push(newMsg);
    listeners.forEach((fn) => fn([...messages]));

    if (msg.duration !== 0) {
      setTimeout(() => {
        MessageManager.remove(id);
      }, msg.duration || 5000);
    }

    return id;
  },

  remove(id: number): void {
    const idx = messages.findIndex((m) => m.id === id);
    if (idx !== -1) {
      messages.splice(idx, 1);
      listeners.forEach((fn) => fn([...messages]));
    }
  },

  subscribe(fn: (msgs: MessageItem[]) => void): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },

  success(content: string): number {
    return MessageManager.add({ type: 'success', content });
  },

  error(content: string): number {
    return MessageManager.add({ type: 'error', content });
  },

  warning(content: string): number {
    return MessageManager.add({ type: 'warning', content });
  },

  info(content: string): number {
    return MessageManager.add({ type: 'info', content });
  },
};

export default MessageManager;

interface TypeConfig {
  icon: ComponentType<{ size: number; className?: string; style?: React.CSSProperties }>;
  bgColor: string;
  borderColor: string;
  textColor: string;
}

const typeConfig: Record<string, TypeConfig> = {
  success: {
    icon: Check,
    bgColor: '#f0f9ff',
    borderColor: '#10b981',
    textColor: '#059669',
  },
  error: {
    icon: X,
    bgColor: '#fef2f2',
    borderColor: '#ef4444',
    textColor: '#dc2626',
  },
  warning: {
    icon: AlertCircle,
    bgColor: '#fffbeb',
    borderColor: '#f59e0b',
    textColor: '#d97706',
  },
  info: {
    icon: AlertCircle,
    bgColor: '#eff6ff',
    borderColor: '#3b82f6',
    textColor: '#2563eb',
  },
};

/**
 * Message 组件渲染器
 */
export function MessageContainer() {
  const [messageList, setMessageList] = useState<MessageItem[]>([]);

  useEffect(() => {
    return MessageManager.subscribe(setMessageList);
  }, []);

  const handleClick = useCallback(() => {
    // 点击其他地方关闭所有消息
    messageList.forEach((msg) => MessageManager.remove(msg.id));
  }, [messageList]);

  if (messageList.length === 0) return null;

  return (
    <div className="message-container" onClick={handleClick}>
      {messageList.map((msg) => (
        <MessageItemComponent key={msg.id} message={msg} />
      ))}
    </div>
  );
}

function MessageItemComponent({ message }: { message: MessageItem }) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    // 入场动画
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      MessageManager.remove(message.id);
    }, 300);
  };

  const config = typeConfig[message.type] || typeConfig.info;
  const Icon = config.icon;

  return (
    <div
      className={`message-item message-${message.type} ${visible && !closing ? 'visible' : ''} ${closing ? 'closing' : ''}`}
      style={{
        backgroundColor: config.bgColor,
        borderColor: config.borderColor,
        color: config.textColor,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <Icon size={18} className="message-icon" style={{ color: config.textColor }} />
      <span className="message-content">{message.content}</span>
      <button
        className="message-close-btn"
        onClick={handleClose}
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}
