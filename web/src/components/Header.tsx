import { Search, Sun, Moon, Monitor, Menu } from 'lucide-react';

/**
 * Header 组件 props
 */
interface HeaderProps {
  isMobile: boolean;
  onOpenMobile: () => void;
}

/**
 * 顶部栏组件
 */
export default function Header({ isMobile, onOpenMobile }: HeaderProps) {
  return (
    <header className="header-bar">
      <div className="header-left">
        {isMobile ? (
          <button
            className="icon-btn"
            type="button"
            aria-label="打开菜单"
            onClick={onOpenMobile}
          >
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
