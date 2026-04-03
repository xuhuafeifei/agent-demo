import {
  Plus,
  Sparkles,
  Trash2,
  ExternalLink,
  Check,
  X,
} from "lucide-react";
import {
  CollapsibleSection,
  ModelCombobox,
  ProviderListItem,
} from "./SettingsPrimitives";

export default function SetModelPage({ modelTab }) {
  const {
    providers,
    selectedProviderId,
    selectedProvider,
    setSelectedProviderId,
    handleProviderToggle,
    handleAddProvider,
    detailForm,
    handleDetailChange,
    qwenCredentialMode,
    connectionResult,
    handleQwenPortalAuth,
    qwenAuthBusy,
    qwenAuthHint,
    setQwenCredentialMode,
    setQwenAuthHint,
    setConnectionResult,
    showApiKey,
    setShowApiKey,
    handleTestConnection,
    testingConnection,
    modelOptions,
    loadingModels,
    handleDeleteProvider,
    handleResetClick,
    handleSave,
    saving,
    resetting,
  } = modelTab;

  return (
    <div className="settings-models-layout">
      {/* Left: Provider list */}
      <aside className="settings-provider-list">
        <div className="settings-provider-list-header">
          <h2>API 提供商</h2>
          <p>配置用于决定agent执行任务时使用的模型和API提供商。</p>
        </div>
        <button
          type="button"
          className="settings-add-provider-btn"
          onClick={handleAddProvider}
        >
          <Plus size={16} />
          <span>添加提供商</span>
        </button>
        <div className="settings-provider-items">
          {providers.map((provider) => (
            <ProviderListItem
              key={provider.id}
              provider={provider}
              selected={provider.id === selectedProviderId}
              onSelect={setSelectedProviderId}
              onToggle={handleProviderToggle}
            />
          ))}
        </div>
      </aside>

      {/* Right: Detail panel */}
      {selectedProvider ? (
        <div className="settings-detail-panel">
          <div className="settings-detail-header">
            <div className="settings-detail-title">
              <span className="settings-detail-icon">
                {typeof selectedProvider.icon === "function" ||
                (selectedProvider.icon &&
                  selectedProvider.icon.$$typeof) ? (
                  <selectedProvider.icon size={24} />
                ) : (
                  selectedProvider.icon
                )}
              </span>
              <span>{selectedProvider.name}</span>
            </div>
            <a href="#" className="settings-detail-help">
              如何配置？
              <ExternalLink size={14} />
            </a>
          </div>

          <div className="settings-detail-form">
            {/* Model Name (模型名称) — uses models[0].id */}
            <div className="settings-form-group">
              <label className="settings-form-label">模型名称</label>
              <input
                type="text"
                className="settings-form-input"
                value={detailForm.modelName}
                onChange={(e) => handleDetailChange("modelName", e.target.value)}
                placeholder="例如: deepseek-reasoner"
              />
            </div>

            {/*
              ─── Qwen Portal 专用：双按钮「Qwen 授权 | 填写 API Key」+ OAuth 说明 / 手填表单
              若此处被改回单一 API Key 输入框，请从 git 恢复本段或对照文档重新接入。
            */}
            {/* API Key / Qwen OAuth */}
            <div className="settings-form-group settings-form-group--qwen-portal">
              <label className="settings-form-label">
                {selectedProviderId === "qwen-portal" &&
                qwenCredentialMode === "oauth"
                  ? "访问凭证"
                  : "API Key"}
                {connectionResult &&
                !(
                  selectedProviderId === "qwen-portal" &&
                  qwenCredentialMode === "oauth"
                ) ? (
                  <span
                    className={`settings-connection-status ${connectionResult}`}
                  >
                    {connectionResult === "success" ? (
                      <>
                        <Check size={12} /> 连接成功
                      </>
                    ) : (
                      <>
                        <X size={12} /> 连接失败
                      </>
                    )}
                  </span>
                ) : null}
                {connectionResult &&
                selectedProviderId === "qwen-portal" &&
                qwenCredentialMode === "oauth" ? (
                  <span
                    className={`settings-connection-status ${connectionResult}`}
                  >
                    {connectionResult === "success" ? (
                      <>
                        <Check size={12} /> 已授权
                      </>
                    ) : (
                      <>
                        <X size={12} /> 未通过
                      </>
                    )}
                  </span>
                ) : null}
              </label>
              {selectedProviderId === "qwen-portal" ? (
                <>
                  <div className="settings-qwen-auth-row settings-qwen-auth-row--split">
                    <button
                      type="button"
                      className={`settings-qwen-auth-btn ${qwenCredentialMode === "oauth" ? "active" : ""}`}
                      onClick={handleQwenPortalAuth}
                      disabled={qwenAuthBusy}
                    >
                      {qwenAuthBusy ? "等待授权中…" : "Qwen 授权"}
                    </button>
                    <button
                      type="button"
                      className={`settings-qwen-apikey-btn ${qwenCredentialMode === "manual" ? "active" : ""}`}
                      onClick={() => {
                        setQwenCredentialMode("manual");
                        setQwenAuthHint("");
                      }}
                    >
                      填写 API Key
                    </button>
                  </div>
                  {qwenCredentialMode === "oauth" ? (
                    <>
                      <p className="settings-form-hint">
                        点击「Qwen 授权」将打开 Qwen 官方认证页，登录后即可使用免费额度；凭证会保存到本机（逻辑与{" "}
                        <code className="settings-inline-code">
                          qwen-oauth-login
                        </code>{" "}
                        CLI 一致）。
                      </p>
                      {qwenAuthHint ? (
                        <p
                          className={`settings-qwen-auth-message ${
                            connectionResult === "success" ? "success" : ""
                          }`}
                          role="status"
                        >
                          {qwenAuthHint}
                        </p>
                      ) : null}
                      <input
                        type="text"
                        className="settings-form-input"
                        value=""
                        readOnly
                        disabled
                        placeholder="无需手动填写 API Key，请使用上方 Qwen 授权"
                      />
                    </>
                  ) : (
                    <>
                      <div className="settings-form-input-row">
                        <input
                          type={showApiKey ? "text" : "password"}
                          className="settings-form-input"
                          value={detailForm.apiKey}
                          onChange={(e) =>
                            handleDetailChange("apiKey", e.target.value)
                          }
                          placeholder="输入 API Key"
                        />
                        <button
                          type="button"
                          className="settings-test-btn"
                          onClick={handleTestConnection}
                          disabled={testingConnection}
                        >
                          {testingConnection ? "测试中..." : "测试连接"}
                        </button>
                      </div>
                      <label className="settings-checkbox-label">
                        <input
                          type="checkbox"
                          checked={showApiKey}
                          onChange={(e) => setShowApiKey(e.target.checked)}
                        />
                        显示 API Key
                      </label>
                      <p className="settings-form-hint settings-qwen-switch-hint">
                        <button
                          type="button"
                          className="settings-qwen-switch-link"
                          onClick={() => {
                            setQwenCredentialMode("oauth");
                            setConnectionResult(null);
                            setQwenAuthHint("");
                          }}
                        >
                          改用浏览器授权（Qwen 授权）
                        </button>
                      </p>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="settings-form-input-row">
                    <input
                      type={showApiKey ? "text" : "password"}
                      className="settings-form-input"
                      value={detailForm.apiKey}
                      onChange={(e) =>
                        handleDetailChange("apiKey", e.target.value)
                      }
                      placeholder="输入 API Key"
                    />
                    <button
                      type="button"
                      className="settings-test-btn"
                      onClick={handleTestConnection}
                      disabled={testingConnection}
                    >
                      {testingConnection ? "测试中..." : "测试连接"}
                    </button>
                  </div>
                  <label className="settings-checkbox-label">
                    <input
                      type="checkbox"
                      checked={showApiKey}
                      onChange={(e) => setShowApiKey(e.target.checked)}
                    />
                    显示 API Key
                  </label>
                </>
              )}
            </div>

            {/* Base URL */}
            <div className="settings-form-group">
              <label className="settings-form-label">Base URL (可选)</label>
              <input
                type="text"
                className="settings-form-input"
                value={detailForm.baseUrl}
                onChange={(e) => handleDetailChange("baseUrl", e.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </div>

            {/* Model (dropdown + text input) */}
            <div className="settings-form-group">
              <label className="settings-form-label">
                模型
                <Sparkles size={14} className="settings-model-sparkle" />
              </label>
              <ModelCombobox
                value={detailForm.model}
                options={modelOptions}
                onChange={(v) => handleDetailChange("model", v)}
                placeholder={
                  loadingModels ? "加载模型列表中..." : "选择或输入模型"
                }
              />
            </div>

            {/* Collapsible sections */}
            <CollapsibleSection title="功能提供商">
              <p className="settings-collapsible-placeholder">功能提供商配置</p>
            </CollapsibleSection>
            <CollapsibleSection title="高级选项">
              <p className="settings-collapsible-placeholder">高级选项配置</p>
            </CollapsibleSection>
          </div>

          {/* Bottom actions */}
          <div className="settings-detail-footer">
            <button
              type="button"
              className="settings-delete-btn"
              onClick={handleDeleteProvider}
            >
              <Trash2 size={14} />
              删除
            </button>
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
                onClick={handleSave}
                disabled={saving || resetting}
              >
                {saving ? "保存中..." : "保存修改"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="settings-detail-empty">
          <p>选择一个提供商以查看配置</p>
        </div>
      )}
    </div>
  );
}

