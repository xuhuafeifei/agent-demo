import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyText } from '../utils/markdown';

/**
 * CopyButton 组件 props
 */
interface CopyButtonProps {
  content: string;
  className?: string;
}

/**
 * 复制按钮组件（提取自 UserMessage 和 AssistantMessage）
 */
export default function CopyButton({ content, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className={`copy-btn ${copied ? 'copied' : ''} ${className}`}
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
  );
}
