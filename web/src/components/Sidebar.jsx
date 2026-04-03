import { useState, useRef } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const SIDEBAR_KEY = "agent_demo_sidebar_collapsed";

const navItems = [
  { key: "chat", label: "聊天", icon: null },
  { key: "overview", label: "概览", icon: null },
  { key: "channel", label: "频道", icon: null },
  { key: "instance", label: "实例", icon: null },
  { key: "session", label: "会话", icon: null },
  { key: "setting", label: "设置", icon: null },
];

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
}) {
  const [tooltip, setTooltip] = useState({ show: false, text: "", x: 0, y: 0 });
  const tooltipTimerRef = useRef(null);

  const items = customNavItems || navItems;
  const wrapperClass = isMobile
    ? `mobile-sidebar ${mobileOpen ? "open" : ""}`
    : `sidebar ${collapsed ? "collapsed" : ""}`;

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

export { SIDEBAR_KEY, navItems };
