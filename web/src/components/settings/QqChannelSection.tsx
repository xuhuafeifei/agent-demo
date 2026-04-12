// @ts-nocheck
import { Eye, EyeOff, HelpCircle } from "lucide-react";

export default function QqChannelSection({
  channelsForm,
  setChannelsForm,
  showQqbotSecret,
  setShowQqbotSecret,
  saving,
}) {
  return (
    <div className="settings-channel-section">
      <div className="settings-channel-section-header">
        <div className="settings-channel-section-title">
          <span className="settings-channel-icon">🐧</span>
          <span>QQBot</span>
        </div>
        <label className="settings-channel-toggle">
          <input
            type="checkbox"
            checked={channelsForm.qqbotEnabled}
            onChange={(e) =>
              setChannelsForm((prev) => ({
                ...prev,
                qqbotEnabled: e.target.checked,
              }))
            }
          />
          <span className="settings-channel-toggle-label">
            {channelsForm.qqbotEnabled ? "已启用" : "未启用"}
          </span>
        </label>
      </div>

      {channelsForm.qqbotEnabled && (
        <div className="settings-channel-fields">
          <div className="settings-form-group">
            <label className="settings-form-label">
              AppId
              <span
                className="settings-field-hint-wrap"
                title="QQ 开放平台应用的 AppId"
              >
                <HelpCircle size={14} />
              </span>
            </label>
            <input
              type="text"
              className="settings-form-input"
              value={channelsForm.qqbotAppId}
              onChange={(e) =>
                setChannelsForm((prev) => ({
                  ...prev,
                  qqbotAppId: e.target.value,
                }))
              }
              placeholder="请输入 QQ 开放平台 AppId"
            />
          </div>

          <div className="settings-form-group">
            <label className="settings-form-label">
              Client Secret
              <span
                className="settings-field-hint-wrap"
                title="QQ 开放平台应用的 Client Secret"
              >
                <HelpCircle size={14} />
              </span>
            </label>
            <div className="settings-form-input-row">
              <input
                type={showQqbotSecret ? "text" : "password"}
                className="settings-form-input"
                value={channelsForm.qqbotClientSecret}
                onChange={(e) =>
                  setChannelsForm((prev) => ({
                    ...prev,
                    qqbotClientSecret: e.target.value,
                  }))
                }
                placeholder={
                  channelsForm.qqbotHasCredentials
                    ? "已保存，留空则不修改"
                    : "请输入 Client Secret"
                }
              />
              <button
                type="button"
                className="settings-icon-btn"
                onClick={() => setShowQqbotSecret((v) => !v)}
                title={showQqbotSecret ? "隐藏" : "显示"}
              >
                {showQqbotSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
