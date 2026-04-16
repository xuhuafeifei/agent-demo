import { useState, useRef } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ReactNode } from 'react';

export const SIDEBAR_KEY = 'agent_demo_sidebar_collapsed';

export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
}

export const navItems: NavItem[] = [
  { key: 'chat', label: '聊天', icon: null },
  { key: 'tasks', label: '调度', icon: null },
  { key: 'setting', label: '设置', icon: null },
];

interface TooltipState {
  show: boolean;
  text: string;
  x: number;
  y: number;
}

/**
 * Sidebar 组件 props
 */
interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  activeNav: string;
  onSelectNav: (key: string) => void;
  isMobile: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  navItems?: NavItem[];
}

/**
 * 侧边栏组件
 */
export default function Sidebar({
  collapsed,
  onToggle,
  activeNav,
  onSelectNav,
  isMobile,
  mobileOpen,
  onCloseMobile,
  navItems: customNavItems,
}: SidebarProps) {
  const [tooltip, setTooltip] = useState<TooltipState>({
    show: false,
    text: '',
    x: 0,
    y: 0,
  });
  const tooltipTimerRef = useRef<number | null>(null);

  const items = customNavItems || navItems;
  const wrapperClass = isMobile
    ? `mobile-sidebar ${mobileOpen ? 'open' : ''}`
    : `sidebar ${collapsed ? 'collapsed' : ''}`;

  return (
    <>
      {isMobile && mobileOpen ? (
        <div className="mobile-mask" onClick={onCloseMobile} />
      ) : null}
      <aside className={wrapperClass} aria-label="主导航">
        <div className="sidebar-head">
          <div className="brand-wrap">
            <div className="brand-logo">A</div>
            {!collapsed ? <div className="brand-title">Agent Demo</div> : null}
          </div>
          {!isMobile ? (
            <button
              className="icon-btn"
              onClick={onToggle}
              aria-label="切换侧边栏"
              type="button"
            >
              {collapsed ? (
                <PanelLeftOpen size={16} />
              ) : (
                <PanelLeftClose size={16} />
              )}
            </button>
          ) : null}
        </div>

        <nav className="sidebar-nav" role="navigation">
          {items.map((item) => {
            const Icon = item.icon as React.ElementType | null;
            const active = activeNav === item.key;
            return (
              <button
                key={item.key}
                className={`nav-item ${active ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  onSelectNav(item.key);
                  if (isMobile) onCloseMobile();
                }}
                onMouseEnter={(event) => {
                  if (isMobile || !collapsed) return;
                  const target = event.currentTarget;
                  window.clearTimeout(tooltipTimerRef.current);
                  tooltipTimerRef.current = window.setTimeout(() => {
                    if (!target) return;
                    const rect = target.getBoundingClientRect();
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
                {Icon ? <Icon size={18} /> : null}
                {!collapsed ? (
                  <span className="nav-label">{item.label}</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          {!collapsed ? <span className="version">v1.0.0</span> : null}
          <span className="online-dot" aria-hidden="true" />
        </div>

        {!isMobile && collapsed && tooltip.show ? (
          <div
            className="nav-tooltip"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <span>{tooltip.text}</span>
            <i />
          </div>
        ) : null}
      </aside>
    </>
  );
}
