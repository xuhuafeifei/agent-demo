import { useMemo, useEffect, useState } from 'react';
import { useChatStore } from '../store/chatStore';

/**
 * ContextUsageIndicator 组件 props
 */
interface ContextUsageIndicatorProps {
  // 可选：最大上下文窗口大小（tokens），如果不传则从 contextEvents 中获取
  maxContextWindow?: number;
}

/**
 * 上下文使用占比指示器
 * 显示在输入框右下角的圆圈，显示当前上下文占比
 */
export default function ContextUsageIndicator({
  maxContextWindow,
}: ContextUsageIndicatorProps) {
  const contextEvents = useChatStore((state) => state.contextEvents);
  const [animatedPercentage, setAnimatedPercentage] = useState(0);

  // 从 contextEvents 中获取最新的上下文使用信息
  const contextUsage = useMemo(() => {
    const usedEvents = contextEvents.filter(
      (event) => event.kind === 'used' && event.contextWindow
    );

    if (usedEvents.length === 0) {
      return { usedTokens: 0, maxTokens: maxContextWindow || 0, percentage: 0 };
    }

    // 获取最新的使用信息
    const latest = usedEvents[usedEvents.length - 1];
    const max = maxContextWindow || latest.contextWindow || 0;
    const used = latest.totalTokens || 0; // 使用 totalTokens 作为实际使用量
    const percentage = max > 0 ? Math.min((used / max) * 100, 100) : 0;

    return {
      usedTokens: used,
      maxTokens: max,
      percentage,
    };
  }, [contextEvents, maxContextWindow]);

  // 动画效果：平滑过渡到目标百分比
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedPercentage(contextUsage.percentage);
    }, 100);

    return () => clearTimeout(timer);
  }, [contextUsage.percentage]);

  // 根据占比决定颜色
  const getColor = (percentage: number) => {
    if (percentage >= 90) return '#ef4444'; // 红色 - 危险
    if (percentage >= 70) return '#f59e0b'; // 橙色 - 警告
    if (percentage >= 50) return '#3b82f6'; // 蓝色 - 中等
    return '#10b981'; // 绿色 - 正常
  };

  const color = getColor(animatedPercentage);

  // 圆的周长
  const radius = 14;
  const strokeWidth = 2.5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (animatedPercentage / 100) * circumference;

  // 如果没有上下文使用，不显示
  if (contextUsage.usedTokens === 0) {
    return null;
  }

  return (
    <div
      className="context-usage-indicator"
      title={`上下文使用: ${contextUsage.usedTokens.toLocaleString()} / ${contextUsage.maxTokens.toLocaleString()} tokens (${Math.round(animatedPercentage)}%)`}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 36 36"
        className="context-usage-svg"
      >
        {/* 背景圆 */}
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          opacity="0.1"
        />
        {/* 进度圆 */}
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 18 18)"
          style={{
            transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease',
          }}
        />
        {/* 百分比文字 */}
        <text
          x="18"
          y="18"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="8"
          fontWeight="700"
          fill={color}
          style={{
            transition: 'fill 0.3s ease',
          }}
        >
          {Math.round(animatedPercentage)}%
        </text>
      </svg>
    </div>
  );
}
