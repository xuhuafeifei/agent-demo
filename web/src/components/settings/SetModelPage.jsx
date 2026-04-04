import { Plus, Sparkles, Trash2, ExternalLink, Check, X } from "lucide-react";
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
    handleQwenCredentialModeChange,
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
    formErrors = {},
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
                (selectedProvider.icon && selectedProvider.icon.$$typeof) ? (
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

            {/*
              ─── Qwen Portal：模式切换（浏览器授权 | API Key）+ 对应 UI；认证类型与保存/测试一并提交
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
                      className={`settings-qwen-apikey-btn ${qwenCredentialMode === "oauth" ? "active" : ""}`}
                      onClick={() => handleQwenCredentialModeChange("oauth")}
                    >
                      浏览器授权
                    </button>
                    <button
                      type="button"
                      className={`settings-qwen-apikey-btn ${qwenCredentialMode === "manual" ? "active" : ""}`}
                      onClick={() => handleQwenCredentialModeChange("manual")}
                    >
                      填写 API Key
                    </button>
                  </div>
                  {qwenCredentialMode === "oauth" ? (
                    <div className="settings-qwen-oauth-block">
                      <p className="settings-form-hint">
                        点击下方按钮打开 Qwen
                        官方认证页，登录后凭证会保存到本机；测试连接与保存均使用 OAuth，不会上传表单中的
                        API Key。
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
                      <div className="settings-qwen-oauth-actions">
                        <button
                          type="button"
                          className="settings-qwen-auth-btn settings-qwen-oauth-actions__primary"
                          onClick={handleQwenPortalAuth}
                          disabled={qwenAuthBusy}
                        >
                          {qwenAuthBusy ? "等待授权中…" : "Qwen 授权"}
                        </button>
                        <button
                          type="button"
                          className="settings-test-btn settings-qwen-oauth-actions__test"
                          onClick={handleTestConnection}
                          disabled={testingConnection}
                        >
                          {testingConnection ? "测试中..." : "测试连接"}
                        </button>
                      </div>
                    </div>
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

            {/* Base URL - qwen-portal oauth 模式显示 OAuth 返回的 resourceUrl */}
            <div className="settings-form-group">
              <label className="settings-form-label">
                {selectedProviderId === "qwen-portal" && qwenCredentialMode === "oauth"
                  ? "API 地址 (OAuth 自动获取)"
                  : "Base URL"}{" "}
                <span className="settings-required">*</span>
              </label>
              {selectedProviderId === "qwen-portal" && qwenCredentialMode === "oauth" ? (
                <div className="settings-qwen-resource-url">
                  <input
                    type="text"
                    className="settings-form-input"
                    value={detailForm.baseUrl}
                    readOnly
                    disabled
                    placeholder="完成 Qwen 授权后自动显示 API 地址"
                  />
                </div>
              ) : (
                <input
                  type="text"
                  className={`settings-form-input ${
                    formErrors.baseUrl ? "error" : ""
                  }`}
                  value={detailForm.baseUrl}
                  onChange={(e) => handleDetailChange("baseUrl", e.target.value)}
                  placeholder="https://api.example.com/v1"
                  required
                />
              )}
            </div>

            {/* Advanced Options */}
            <CollapsibleSection title="高级选项" defaultOpen>
              <div className="settings-form-group">
                <label className="settings-form-label">Max Tokens</label>
                <input
                  type="number"
                  className="settings-form-input"
                  min={0}
                  value={
                    detailForm.maxTokens === "" ||
                    detailForm.maxTokens === undefined ||
                    detailForm.maxTokens === null
                      ? ""
                      : detailForm.maxTokens
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") {
                      handleDetailChange("maxTokens", "");
                      return;
                    }
                    const n = parseInt(v, 10);
                    handleDetailChange(
                      "maxTokens",
                      Number.isFinite(n) ? n : "",
                    );
                  }}
                  placeholder="例如 65536"
                />
                <p className="settings-advanced-hint">
                  上下文窗口对应的 Token 上限；常用约 64K（65536）。用于判断是否触发会话压缩。
                </p>
              </div>
              <div className="settings-form-group">
                <label className="settings-form-label">Token Ratio</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  className="settings-form-input"
                  value={
                    detailForm.tokenRatio === "" ||
                    detailForm.tokenRatio === undefined ||
                    detailForm.tokenRatio === null
                      ? ""
                      : detailForm.tokenRatio
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") {
                      handleDetailChange("tokenRatio", "");
                      return;
                    }
                    const n = parseFloat(v);
                    handleDetailChange(
                      "tokenRatio",
                      Number.isFinite(n) ? n : "",
                    );
                  }}
                  placeholder="例如 0.75"
                />
                <p className="settings-advanced-hint">
                  压缩阈值比例（默认 0.75）。当估算 Token 超过 Max Tokens
                  × 该比例时，将尝试压缩上下文。
                </p>
              </div>
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
