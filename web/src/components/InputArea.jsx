import { useState, useRef, useEffect } from "react";
import {
  AtSign,
  Paperclip,
  ArrowUp,
  ArrowDown,
  Settings,
} from "lucide-react";
import { useChatStore } from "../store/chatStore";

/**
 * 底部输入框组件
 */
export default function InputArea({ onSend, scrollRef, showScrollButton }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);
  const isStreaming = useChatStore((state) => state.isStreaming);

  const canSend = value.trim().length > 0 && !isStreaming;

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <section className="input-wrap">
      <div className="input-card">
        {showScrollButton && (
          <button
            className="scroll-to-bottom-btn"
            type="button"
            aria-label="滚动到底部"
            onClick={scrollToBottom}
          >
            <ArrowDown size={16} />
          </button>
        )}
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
