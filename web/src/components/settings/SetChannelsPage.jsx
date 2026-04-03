import { TABS } from "./constants";

export default function SetChannelsPage({ activeTab }) {
  return (
    <div className="settings-tab-placeholder">
      <p>{TABS.find((t) => t.key === activeTab)?.label} 配置页面开发中...</p>
    </div>
  );
}

