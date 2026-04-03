import { Eye, EyeOff, HelpCircle } from "lucide-react";

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

  return (
    <div className="settings-channels-layout">
      <div className="settings-channels-card">
        <div className="settings-channels-header">
          <div>
            <h2>通道配置</h2>
            <p className="settings-channels-desc">
              配置消息通道，支持 QQBot 等接入方式。
            </p>
          </div>
        </div>

        <div className="settings-channels-body">
          {/* QQBot 通道 */}
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
                {/* AppId */}
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

                {/* Client Secret */}
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
                      placeholder="请输入 Client Secret"
                    />
                    <button
                      type="button"
                      className="settings-icon-btn"
                      onClick={() => setShowQqbotSecret((v) => !v)}
                      title={showQqbotSecret ? "隐藏" : "显示"}
                    >
                      {showQqbotSecret ? (
                        <EyeOff size={16} />
                      ) : (
                        <Eye size={16} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Target OpenID */}
                <div className="settings-form-group">
                  <label className="settings-form-label">
                    Target OpenID
                    <span
                      className="settings-field-hint-wrap"
                      title="可选，指定目标用户的 OpenID"
                    >
                      <HelpCircle size={14} />
                    </span>
                  </label>
                  <input
                    type="text"
                    className="settings-form-input"
                    value={channelsForm.qqbotTargetOpenid}
                    onChange={(e) =>
                      setChannelsForm((prev) => ({
                        ...prev,
                        qqbotTargetOpenid: e.target.value,
                      }))
                    }
                    placeholder="可选，指定目标用户 OpenID"
                  />
                </div>

                {/* Accounts */}
                <div className="settings-form-group">
                  <label className="settings-form-label">
                    账号配置（JSON）
                    <span
                      className="settings-field-hint-wrap"
                      title="可选，多账号配置的 JSON 数组"
                    >
                      <HelpCircle size={14} />
                    </span>
                  </label>
                  <textarea
                    className="settings-form-input settings-form-textarea"
                    value={channelsForm.qqbotAccounts}
                    onChange={(e) =>
                      setChannelsForm((prev) => ({
                        ...prev,
                        qqbotAccounts: e.target.value,
                      }))
                    }
                    placeholder='[{"appId": "...", "clientSecret": "..."}]'
                    rows={4}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom actions */}
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
