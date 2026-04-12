// @ts-nocheck
import { useState } from "react";
import QqChannelSection from "./QqChannelSection";
import WeixinChannelSection from "./WeixinChannelSection";

export default function SetChannelsPage({ channelsTab }) {
  const {
    channelsForm,
    setChannelsForm,
    showQqbotSecret,
    setShowQqbotSecret,
    saving,
    resetting,
    handleResetClick,
    handleSaveChannels,
  } = channelsTab;

  /** 二级标签：QQ 与微信分屏配置，避免多 Bot 列表与 QQ 表单挤在一起 */
  const [channelPanel, setChannelPanel] = useState("qq");

  return (
    <div className="settings-channels-layout">
      <div className="settings-channels-card">
        <div className="settings-channels-header">
          <div>
            <h2>通道配置</h2>
            <p className="settings-channels-desc">
              通过下方标签分别配置 QQBot 与微信；修改后请点击底部「保存修改」。
            </p>
          </div>
        </div>

        <div className="settings-channels-body">
          <div
            className="settings-channels-inner-tabs"
            role="tablist"
            aria-label="通道类型"
          >
            <button
              type="button"
              role="tab"
              aria-selected={channelPanel === "qq"}
              className={`settings-channels-inner-tab${channelPanel === "qq" ? " active" : ""}`}
              onClick={() => setChannelPanel("qq")}
            >
              <span className="settings-channels-inner-tab-icon" aria-hidden>
                🐧
              </span>
              QQBot
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={channelPanel === "weixin"}
              className={`settings-channels-inner-tab${channelPanel === "weixin" ? " active" : ""}`}
              onClick={() => setChannelPanel("weixin")}
            >
              <span className="settings-channels-inner-tab-icon" aria-hidden>
                💬
              </span>
              微信（iLink 扫码）
            </button>
          </div>

          <div
            className="settings-channels-panel"
            role="tabpanel"
            aria-live="polite"
          >
            {channelPanel === "qq" ? (
              <QqChannelSection
                channelsForm={channelsForm}
                setChannelsForm={setChannelsForm}
                showQqbotSecret={showQqbotSecret}
                setShowQqbotSecret={setShowQqbotSecret}
              />
            ) : (
              <WeixinChannelSection
                channelsForm={channelsForm}
                setChannelsForm={setChannelsForm}
                saving={saving}
              />
            )}
          </div>
        </div>

        <div className="settings-detail-footer">
          <div />
          <div className="settings-detail-actions">
            <button
              type="button"
              className="settings-reset-btn"
              onClick={handleResetClick}
              disabled={resetting || saving}
            >
              {resetting ? "恢复中..." : "恢复默认"}
            </button>
            <button
              type="button"
              className="settings-save-btn"
              onClick={handleSaveChannels}
              disabled={saving || resetting}
            >
              {saving ? "保存中..." : "保存修改"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
