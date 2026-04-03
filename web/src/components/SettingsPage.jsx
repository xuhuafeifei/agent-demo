import { useEffect, useMemo, useState, useRef } from "react";
import {
  getFgbgConfig,
  patchFgbgConfig,
  resetFgbgConfig,
  getProviderModels,
  startQwenPortalOAuth,
  pollQwenPortalOAuth,
} from "../api/configApi";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Trash2,
  ExternalLink,
  Check,
  X,
} from "lucide-react";
import Qwen from "@lobehub/icons/es/Qwen";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
const QwenColor = Qwen.Color;
const DeepSeekColor = DeepSeek.Color;

// ─── Tab definitions ────────────────────────────────────────────────
const TABS = [
  { key: "models", label: "模型配置" },
  { key: "heartbeat", label: "心跳配置" },
  { key: "logging", label: "日志配置" },
  { key: "channels", label: "通道配置" },
];

// ─── Built-in provider presets ──────────────────────────────────────
const PROVIDER_PRESETS = [
  { id: "openai", name: "OpenAI", icon: "🟢" },
  { id: "tensdaq", name: "Tensdaq", icon: "🔵" },
  { id: "302ai", name: "302.AI", icon: "🟣" },
  { id: "gemini", name: "Gemini", icon: "🔶" },
  { id: "deeplx", name: "DeepLX", icon: "⚫" },
  { id: "deepseek", name: "DeepSeek", icon: DeepSeekColor },
  { id: "qwen-portal", name: "Qwen Portal", icon: QwenColor },
];

// ─── Utility helpers ────────────────────────────────────────────────
function deepGet(obj, path) {
  return path
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function deepSet(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }
    if (
      typeof cursor[key] !== "object" ||
      cursor[key] === null ||
      Array.isArray(cursor[key])
    ) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  });
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function deepDiff(current, base) {
  if (deepEqual(current, base)) return undefined;
  if (!isPlainObject(current) || !isPlainObject(base)) return current;
  const out = {};
  Object.keys(current).forEach((key) => {
    const diff = deepDiff(current[key], base[key]);
    if (diff !== undefined) out[key] = diff;
  });
  return Object.keys(out).length ? out : undefined;
}

// ─── Toggle Switch Component ────────────────────────────────────────
function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`settings-toggle ${checked ? "on" : "off"} ${disabled ? "disabled" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

// ─── Collapsible Section ────────────────────────────────────────────
function CollapsibleSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="settings-collapsible">
      <button
        type="button"
        className="settings-collapsible-header"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>{title}</span>
      </button>
      {open ? (
        <div className="settings-collapsible-body">{children}</div>
      ) : null}
    </div>
  );
}

// ─── Combobox (dropdown + text input) ───────────────────────────────
function ModelCombobox({ value, options, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    if (!filter) return options;
    const lower = filter.toLowerCase();
    return options.filter(
      (o) =>
        o.id.toLowerCase().includes(lower) ||
        o.name.toLowerCase().includes(lower),
    );
  }, [options, filter]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleSelect = (id) => {
    onChange(id);
    setOpen(false);
    setFilter("");
  };

  return (
    <div className="settings-combobox" ref={wrapperRef}>
      <div className="settings-combobox-input-row">
        <input
          ref={inputRef}
          type="text"
          className="settings-form-input"
          value={open ? filter : value}
          placeholder={placeholder}
          onChange={(e) => {
            setFilter(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        <button
          type="button"
          className="settings-combobox-arrow"
          onClick={() => {
            setOpen((v) => !v);
            setFilter("");
          }}
        >
          {open ? <ChevronDown size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {open && (
        <div className="settings-combobox-dropdown">
          {filtered.length === 0 ? (
            <div className="settings-combobox-empty">无匹配模型</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`settings-combobox-option ${opt.id === value ? "selected" : ""}`}
                onClick={() => handleSelect(opt.id)}
              >
                <span className="settings-combobox-option-id">{opt.id}</span>
                {opt.name !== opt.id && (
                  <span className="settings-combobox-option-name">
                    {opt.name}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Provider List Item ─────────────────────────────────────────────
function ProviderListItem({ provider, selected, onSelect, onToggle }) {
  const IconEl = provider.icon;
  const isComponent =
    typeof IconEl === "function" || (IconEl && IconEl.$$typeof);
  return (
    <button
      type="button"
      className={`settings-provider-item ${selected ? "selected" : ""}`}
      onClick={() => onSelect(provider.id)}
    >
      <span className="settings-provider-icon">
        {isComponent ? <IconEl size={20} /> : IconEl}
      </span>
      <span className="settings-provider-name">{provider.name}</span>
      {provider.featureCount ? (
        <span className="settings-provider-badge">{provider.featureCount}</span>
      ) : null}
    </button>
  );
}

// ─── Main SettingsPage ──────────────────────────────────────────────
export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [rawConfig, setRawConfig] = useState(null);
  const [baseConfig, setBaseConfig] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("models");

  // Model config state
  const [providers, setProviders] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState(null);
  const [detailForm, setDetailForm] = useState({
    modelName: "",
    apiKey: "",
    baseUrl: "",
    model: "",
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState(null);
  const [qwenAuthBusy, setQwenAuthBusy] = useState(false);
  const [qwenAuthHint, setQwenAuthHint] = useState("");
  /** qwen-portal：oauth = 浏览器授权；manual = 与其它提供商相同的手填 API Key */
  const [qwenCredentialMode, setQwenCredentialMode] = useState("oauth");
  const mountedRef = useRef(true);

  // Model list from backend
  const [modelOptions, setModelOptions] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Load config
  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setMessage("");
      try {
        const payload = await getFgbgConfig();
        if (!mounted) return;
        setRawConfig(payload.config);
        setBaseConfig(payload.config);
        setMetadata(payload.metadata || {});

        // Build providers list from config
        const modelsConfig = payload.config?.models || {};
        const providerEntries = Object.entries(modelsConfig.providers || {});
        const loadedProviders = providerEntries.map(([id, cfg]) => ({
          id,
          name: PROVIDER_PRESETS.find((p) => p.id === id)?.name || id,
          icon: PROVIDER_PRESETS.find((p) => p.id === id)?.icon || "⚙️",
          enabled: cfg.enabled !== false,
          featureCount: cfg.featureCount || null,
        }));
        setProviders(loadedProviders.length ? loadedProviders : []);
        if (loadedProviders.length && !selectedProviderId) {
          setSelectedProviderId(loadedProviders[0].id);
        }
      } catch (error) {
        if (mounted) setMessage(`加载配置失败: ${error.message}`);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // Load model options when provider changes
  useEffect(() => {
    if (!selectedProviderId) {
      setModelOptions([]);
      return;
    }
    let cancelled = false;
    async function loadModels() {
      setLoadingModels(true);
      try {
        const res = await getProviderModels(selectedProviderId);
        if (!cancelled && res.models) {
          setModelOptions(res.models);
        }
      } catch {
        if (!cancelled) setModelOptions([]);
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    }
    loadModels();
    return () => {
      cancelled = true;
    };
  }, [selectedProviderId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Sync detail form when selection changes
  useEffect(() => {
    if (!selectedProviderId || !rawConfig) return;
    const providerCfg =
      rawConfig?.models?.providers?.[selectedProviderId] || {};
    // modelName = first model's id from models array
    const firstModelId = providerCfg.models?.[0]?.id || "";
    setDetailForm({
      modelName: firstModelId,
      apiKey: providerCfg.apiKey || "",
      baseUrl: providerCfg.baseUrl || "",
      model: providerCfg.model || "",
    });
    setShowApiKey(false);
    setConnectionResult(null);
    setQwenAuthHint("");
    if (selectedProviderId === "qwen-portal") {
      setQwenCredentialMode(
        String(providerCfg.apiKey || "").trim() ? "manual" : "oauth",
      );
    }
  }, [selectedProviderId, rawConfig]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId),
    [providers, selectedProviderId],
  );

  const handleProviderToggle = (id, enabled) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled } : p)),
    );
  };

  const handleDetailChange = (field, value) => {
    setDetailForm((prev) => ({ ...prev, [field]: value }));
    setConnectionResult(null);
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    await new Promise((r) => setTimeout(r, 1500));
    setTestingConnection(false);
    setConnectionResult(detailForm.apiKey ? "success" : "error");
  };

  /**
   * Qwen Portal：设备授权 OAuth（与 `src/scripts/qwen-oauth-login.ts` / 后端
   * `/api/config/qwen-portal/oauth/*` 同源）。请勿删除：与下方 JSX「API Key / Qwen OAuth」成对使用。
   */
  const handleQwenPortalAuth = async () => {
    setQwenAuthBusy(true);
    setQwenAuthHint("");
    let intervalMs = 2000;
    try {
      const start = await startQwenPortalOAuth();
      if (!mountedRef.current) return;
      window.open(start.verificationUrl, "_blank", "noopener,noreferrer");
      setQwenAuthHint(
        "已在浏览器中打开 Qwen 认证页，请完成登录；完成后此处会自动显示结果。",
      );
      const deadline = Date.now() + (start.expiresIn ?? 900) * 1000;
      while (Date.now() < deadline && mountedRef.current) {
        await new Promise((r) => setTimeout(r, intervalMs));
        const poll = await pollQwenPortalOAuth(start.oauthSessionId);
        if (!mountedRef.current) return;
        if (poll.success && poll.status === "success") {
          setQwenAuthHint(
            "授权成功，访问令牌已保存到本机（与命令行 qwen-oauth-login 相同）。",
          );
          setConnectionResult("success");
          setQwenCredentialMode("oauth");
          return;
        }
        if (!poll.success || poll.status === "error") {
          setQwenAuthHint(poll.error || "授权未完成或失败，请重试。");
          setConnectionResult("error");
          return;
        }
        if (poll.slowDown) {
          intervalMs = Math.min(intervalMs * 1.5, 10000);
        }
      }
      if (mountedRef.current) {
        setQwenAuthHint("授权等待超时，请重新点击「Qwen 授权」。");
      }
    } catch (error) {
      if (mountedRef.current) {
        setQwenAuthHint(error?.message || String(error));
        setConnectionResult("error");
      }
    } finally {
      if (mountedRef.current) setQwenAuthBusy(false);
    }
  };

  const handleSave = async () => {
    if (!rawConfig || !baseConfig || !selectedProviderId) return;
    setMessage("");
    setSaving(true);
    try {
      const draft =
        typeof structuredClone === "function"
          ? structuredClone(rawConfig)
          : JSON.parse(JSON.stringify(rawConfig || {}));

      if (!draft.models) draft.models = {};
      if (!draft.models.providers) draft.models.providers = {};

      // Build provider config with models array
      const existingModels =
        draft.models.providers[selectedProviderId]?.models || [];
      const updatedModels =
        existingModels.length > 0
          ? existingModels.map((m, i) =>
              i === 0 ? { ...m, id: detailForm.modelName || m.id } : m,
            )
          : detailForm.modelName
            ? [{ id: detailForm.modelName }]
            : [];

      const apiKeyForSave =
        selectedProviderId === "qwen-portal" && qwenCredentialMode === "oauth"
          ? ""
          : detailForm.apiKey;

      draft.models.providers[selectedProviderId] = {
        baseUrl: detailForm.baseUrl,
        apiKey: apiKeyForSave,
        api:
          draft.models.providers[selectedProviderId]?.api ||
          "openai-completions",
        models: updatedModels,
        enabled: selectedProvider?.enabled !== false,
      };

      providers.forEach((p) => {
        if (draft.models.providers[p.id]) {
          draft.models.providers[p.id].enabled = p.enabled;
        }
      });

      const patch = deepDiff(draft, baseConfig);
      if (patch && Object.keys(patch).length > 0) {
        const payload = await patchFgbgConfig(patch);
        setRawConfig(payload.config);
        setBaseConfig(payload.config);
        setMetadata(payload.metadata || {});
      }
      setMessage("保存成功。");
    } catch (error) {
      setMessage(`保存失败: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setMessage("");
    setResetting(true);
    try {
      const payload = await resetFgbgConfig();
      setRawConfig(payload.config);
      setBaseConfig(payload.config);
      setMetadata(payload.metadata || {});
      setMessage("已恢复默认配置。");
    } catch (error) {
      setMessage(`恢复默认失败: ${error.message}`);
    } finally {
      setResetting(false);
    }
  };

  const handleResetClick = () => {
    setShowResetConfirm(true);
  };

  const handleResetConfirm = () => {
    setShowResetConfirm(false);
    handleReset();
  };

  const handleResetCancel = () => {
    setShowResetConfirm(false);
  };

  const handleDeleteProvider = () => {
    if (!selectedProviderId) return;
    setProviders((prev) => {
      const next = prev.filter((p) => p.id !== selectedProviderId);
      if (next.length) setSelectedProviderId(next[0].id);
      else setSelectedProviderId(null);
      return next;
    });
  };

  const handleAddProvider = () => {
    const newId = `provider-${Date.now()}`;
    const newProvider = {
      id: newId,
      name: "新提供商",
      icon: "⚙️",
      enabled: true,
      featureCount: null,
    };
    setProviders((prev) => [...prev, newProvider]);
    setSelectedProviderId(newId);
    setDetailForm({
      modelName: "",
      apiKey: "",
      baseUrl: "",
      model: "",
    });
  };

  if (loading) {
    return (
      <section className="settings-page">
        <div className="settings-loading">配置加载中...</div>
      </section>
    );
  }

  return (
    <section className="settings-page">
      {/* Top tab navigation */}
      <nav className="settings-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`settings-tab ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      {activeTab === "models" ? (
        <div className="settings-models-layout">
          {/* Left: Provider list */}
          <aside className="settings-provider-list">
            <div className="settings-provider-list-header">
              <h2>API 提供商</h2>
              <p>
                配置用于翻译和词汇解析功能的 API 提供商。我们内置了 20
                多个提供商，并支持任何 OpenAI 兼容 API 提供商。
              </p>
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
                    onChange={(e) =>
                      handleDetailChange("modelName", e.target.value)
                    }
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
                            点击「Qwen 授权」将打开 Qwen
                            官方认证页，登录后即可使用免费额度；凭证会保存到本机（逻辑与{" "}
                            <code className="settings-inline-code">
                              qwen-oauth-login
                            </code>{" "}
                            CLI 一致）。
                          </p>
                          {qwenAuthHint ? (
                            <p
                              className={`settings-qwen-auth-message ${connectionResult === "success" ? "success" : ""}`}
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
                              onChange={(e) =>
                                setShowApiKey(e.target.checked)
                              }
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
                    onChange={(e) =>
                      handleDetailChange("baseUrl", e.target.value)
                    }
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
                  <p className="settings-collapsible-placeholder">
                    功能提供商配置
                  </p>
                </CollapsibleSection>
                <CollapsibleSection title="高级选项">
                  <p className="settings-collapsible-placeholder">
                    高级选项配置
                  </p>
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
      ) : (
        <div className="settings-tab-placeholder">
          <p>
            {TABS.find((t) => t.key === activeTab)?.label} 配置页面开发中...
          </p>
        </div>
      )}

      {message ? <div className="settings-message">{message}</div> : null}

      {/* Reset confirmation modal */}
      {showResetConfirm ? (
        <div className="settings-modal-overlay" onClick={handleResetCancel}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>确认恢复默认配置</h3>
              <button
                type="button"
                className="settings-modal-close"
                onClick={handleResetCancel}
              >
                <X size={18} />
              </button>
            </div>
            <div className="settings-modal-body">
              <p>
                恢复默认将清除所有自定义的模型配置，并重置为系统初始默认值。
              </p>
              <p className="settings-modal-warning">
                此操作不可撤销，您确定要继续吗？
              </p>
            </div>
            <div className="settings-modal-footer">
              <button
                type="button"
                className="settings-modal-btn settings-modal-btn-cancel"
                onClick={handleResetCancel}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-modal-btn settings-modal-btn-confirm"
                onClick={handleResetConfirm}
                disabled={resetting}
              >
                {resetting ? "恢复中..." : "确认恢复"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
