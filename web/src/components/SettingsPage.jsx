import { useEffect, useMemo, useState, useRef } from "react";
import {
  getFgbgConfig,
  patchFgbgConfig,
  resetFgbgConfig,
  getProviderModels,
  getSupportedModelProviders,
  evictLoggingCache,
  startQwenPortalOAuth,
  pollQwenPortalOAuth,
  testMemorySearchConfig,
  repairLocalMemorySearch,
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
  HelpCircle,
  RefreshCw,
} from "lucide-react";
import Qwen from "@lobehub/icons/es/Qwen";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
const QwenColor = Qwen.Color;
const DeepSeekColor = DeepSeek.Color;

// ─── Tab definitions ────────────────────────────────────────────────
const TABS = [
  { key: "models", label: "模型配置" },
  { key: "memoryHeartbeat", label: "记忆与心跳" },
  { key: "logging", label: "日志配置" },
  { key: "channels", label: "通道配置" },
];

/** 本地记忆嵌入：与后端 `parseFgbgUserConfig` 固定值一致 */
const LOCAL_MEMORY_MODEL = "nomic-embed-text-v1.5.Q4_K_M";
const LOCAL_EMBEDDING_DIMENSIONS = 768;

/** 测试用：remote 且未填 model 时不带 model 字段，后端与已保存配置合并 */
function buildMemorySearchPayloadForTest(form, rawConfig) {
  const download = {
    enabled: form.downloadEnabled,
    url: String(form.downloadUrl || "").trim(),
    timeout: Math.max(1000, Number(form.downloadTimeout) || 300000),
  };
  const chunkMaxChars = Math.max(1, Number(form.chunkMaxChars) || 500);
  if (form.mode === "local") {
    return {
      mode: "local",
      model: String(form.model || "").trim() || LOCAL_MEMORY_MODEL,
      endpoint: "",
      apiKey: "",
      chunkMaxChars,
      embeddingDimensions: LOCAL_EMBEDDING_DIMENSIONS,
      download,
    };
  }
  const trimmedModel = String(form.model || "").trim();
  const payload = {
    mode: "remote",
    endpoint: String(form.endpoint || "").trim(),
    apiKey: form.apiKey ?? "",
    chunkMaxChars,
    embeddingDimensions: Math.max(1, Number(form.embeddingDimensions) || 768),
    download,
  };
  if (trimmedModel) {
    payload.model = trimmedModel;
  }
  return payload;
}

/** 保存用：remote 且未填 model 时沿用 rawConfig 中的 model，避免覆盖为空 */
function buildMemorySearchForSave(form, rawConfig) {
  const baseMs = rawConfig?.agents?.memorySearch;
  const trimmed = String(form.model || "").trim();
  if (form.mode === "local") {
    return {
      mode: "local",
      model: trimmed || LOCAL_MEMORY_MODEL,
      endpoint: "",
      apiKey: "",
      chunkMaxChars: Math.max(1, Number(form.chunkMaxChars) || 500),
      embeddingDimensions: LOCAL_EMBEDDING_DIMENSIONS,
      download: {
        enabled: form.downloadEnabled,
        url: String(form.downloadUrl || "").trim(),
        timeout: Math.max(1000, Number(form.downloadTimeout) || 300000),
      },
    };
  }
  return {
    mode: "remote",
    model: trimmed || baseMs?.model || "",
    endpoint: String(form.endpoint || "").trim(),
    apiKey: form.apiKey ?? "",
    chunkMaxChars: Math.max(1, Number(form.chunkMaxChars) || 500),
    embeddingDimensions: Math.max(1, Number(form.embeddingDimensions) || 768),
    download: {
      enabled: form.downloadEnabled,
      url: String(form.downloadUrl || "").trim(),
      timeout: Math.max(1000, Number(form.downloadTimeout) || 300000),
    },
  };
}

// ─── Provider icon mapping ────────────────────────────────────────
function getProviderIcon(providerId) {
  const iconMap = {
    "qwen-portal": QwenColor,
    deepseek: DeepSeekColor,
    minimax: "🔵",
    moonshot: "🌙",
    "kimi-code": "🌟",
    xiaomi: "MI",
    ollama: "🦙",
  };
  return iconMap[providerId] || "⚙️";
}

function getProviderName(providerId, providerInfo) {
  const nameMap = {
    "qwen-portal": "Qwen Portal",
    deepseek: "DeepSeek",
    minimax: "MiniMax",
    moonshot: "Moonshot",
    "kimi-code": "Kimi Code",
    xiaomi: "Xiaomi",
    ollama: "Ollama",
  };
  return nameMap[providerId] || providerInfo?.name || providerId;
}

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

  // Logging config state
  const [loggingForm, setLoggingForm] = useState({
    cacheTimeSecond: 300,
    level: "info",
    logDir: "/tmp/fgbg",
    consoleLevel: "debug",
    consoleStyle: "pretty",
    allowModule: [],
  });
  const [evictingCache, setEvictingCache] = useState(false);
  // 日志配置过长：默认收起，仅保留简短配置头；用户可展开查看更多配置项
  const [loggingConfigExpanded, setLoggingConfigExpanded] = useState(false);

  /** 记忆检索 + 心跳（单页） */
  const [memoryHeartbeatForm, setMemoryHeartbeatForm] = useState({
    mode: "local",
    model: LOCAL_MEMORY_MODEL,
    endpoint: "",
    apiKey: "",
    chunkMaxChars: 500,
    embeddingDimensions: LOCAL_EMBEDDING_DIMENSIONS,
    downloadEnabled: true,
    downloadUrl: "",
    downloadTimeout: 300000,
    heartbeatEnabled: true,
    intervalMs: 1000,
    concurrency: 2,
    allowedScripts: "[]",
  });
  const [showMemoryApiKey, setShowMemoryApiKey] = useState(false);
  const [memorySearchTesting, setMemorySearchTesting] = useState(false);
  const [memorySearchRepairing, setMemorySearchRepairing] = useState(false);
  const [memorySearchTestResult, setMemorySearchTestResult] = useState(null);
  const [memorySearchTestHint, setMemorySearchTestHint] = useState("");
  /** 测试失败时的修复入口：本地→下载模型；远程→可降级本地 */
  const [memorySearchTestFix, setMemorySearchTestFix] = useState(null);

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

  // Built-in providers from backend
  const [builtinProviders, setBuiltinProviders] = useState([]);
  const [loadingProviders, setLoadingProviders] = useState(false);

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

        // Sync logging form from config
        const logging = payload.config?.logging || {};
        const fullPath = logging.file || "/tmp/fgbg/fgbg-YYYY-MM-DD.log";
        const lastSlash = fullPath.lastIndexOf("/");
        setLoggingForm({
          cacheTimeSecond: logging.cacheTimeSecond ?? 300,
          level: logging.level ?? "info",
          logDir: lastSlash >= 0 ? fullPath.slice(0, lastSlash) : "/tmp/fgbg",
          consoleLevel: logging.consoleLevel ?? "debug",
          consoleStyle: logging.consoleStyle ?? "pretty",
          allowModule: Array.isArray(logging.allowModule)
            ? logging.allowModule
            : [],
        });
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

  // 合并「后端内置提供商列表」与 fgbg 里已配置的 providers（不依赖写死的 PROVIDER_PRESETS）
  useEffect(() => {
    if (!rawConfig) return;
    const modelsConfig = rawConfig.models || {};
    const providerEntries = Object.entries(modelsConfig.providers || {});
    const allProviderIds = new Set([
      ...builtinProviders.map((p) => p.id),
      ...providerEntries.map(([id]) => id),
    ]);
    const loaded = Array.from(allProviderIds).map((id) => {
      const cfg = modelsConfig.providers?.[id];
      const builtinInfo = builtinProviders.find((p) => p.id === id);
      return {
        id,
        name: getProviderName(id, builtinInfo),
        icon: getProviderIcon(id),
        enabled: cfg?.enabled !== false,
        featureCount: cfg?.featureCount || null,
        isBuiltin: !!builtinInfo,
      };
    });
    setProviders(loaded.length ? loaded : []);
    setSelectedProviderId((prev) => {
      if (prev && loaded.some((p) => p.id === prev)) return prev;
      return loaded[0]?.id ?? null;
    });
  }, [rawConfig, builtinProviders]);

  // 从 fgbg 配置同步「记忆 + 心跳」表单
  useEffect(() => {
    if (!rawConfig) return;
    const ms = rawConfig.agents?.memorySearch;
    const hb = rawConfig.heartbeat;
    const mode = ms?.mode === "remote" ? "remote" : "local";
    const hbConc = Number(hb?.concurrency);
    const concurrencyClamped =
      Number.isFinite(hbConc) && hbConc >= 1 && hbConc <= 3
        ? hbConc
        : Math.min(3, Math.max(1, hbConc || 2));
    setMemoryHeartbeatForm({
      mode,
      model:
        mode === "local"
          ? (ms?.model && String(ms.model).trim()) || LOCAL_MEMORY_MODEL
          : (ms?.model ?? "").trim(),
      endpoint: (ms?.endpoint ?? "").trim(),
      apiKey: ms?.apiKey ?? "",
      chunkMaxChars:
        typeof ms?.chunkMaxChars === "number" && ms.chunkMaxChars > 0
          ? ms.chunkMaxChars
          : 500,
      embeddingDimensions:
        mode === "local"
          ? LOCAL_EMBEDDING_DIMENSIONS
          : typeof ms?.embeddingDimensions === "number" &&
              ms.embeddingDimensions > 0
            ? ms.embeddingDimensions
            : 768,
      downloadEnabled: ms?.download?.enabled !== false,
      downloadUrl: (ms?.download?.url ?? "").trim(),
      downloadTimeout:
        typeof ms?.download?.timeout === "number" && ms.download.timeout >= 1000
          ? ms.download.timeout
          : 300000,
      heartbeatEnabled: hb?.enabled !== false,
      intervalMs:
        typeof hb?.intervalMs === "number" &&
        hb.intervalMs >= 200 &&
        hb.intervalMs <= 60000
          ? hb.intervalMs
          : 1000,
      concurrency: concurrencyClamped,
      allowedScripts: JSON.stringify(hb?.allowedScripts ?? [], null, 2),
    });
    setShowMemoryApiKey(false);
  }, [rawConfig]);

  // Load built-in providers from backend
  useEffect(() => {
    let mounted = true;
    async function loadBuiltinProviders() {
      setLoadingProviders(true);
      try {
        const payload = await getSupportedModelProviders();
        if (!mounted) return;
        setBuiltinProviders(payload.providers || []);
      } catch (error) {
        if (mounted) {
          console.error(
            "Failed to load loadBuiltinProviders providers:",
            error,
          );
        }
      } finally {
        if (mounted) setLoadingProviders(false);
      }
    }
    loadBuiltinProviders();
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
          setQwenAuthHint("授权成功，访问令牌已保存到本机");
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

      // 获取当前供应商的内置信息
      const builtinInfo = builtinProviders.find(
        (p) => p.id === selectedProviderId,
      );

      // Build provider config with models array
      const existingModels =
        draft.models.providers[selectedProviderId]?.models || [];

      // 对于内置供应商，保留其默认的 models 配置
      const updatedModels =
        builtinInfo?.models?.length > 0
          ? builtinInfo.models.map((m, i) =>
              i === 0 ? { ...m, id: detailForm.modelName || m.id } : m,
            )
          : existingModels.length > 0
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
        baseUrl: detailForm.baseUrl || builtinInfo?.baseUrl || "",
        apiKey: apiKeyForSave,
        api:
          draft.models.providers[selectedProviderId]?.api ||
          builtinInfo?.api ||
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

  const handleSaveLogging = async () => {
    if (!rawConfig || !baseConfig) return;
    setMessage("");
    setSaving(true);
    try {
      const draft =
        typeof structuredClone === "function"
          ? structuredClone(rawConfig)
          : JSON.parse(JSON.stringify(rawConfig || {}));

      // Construct full file path: dir + /fgbg-YYYY-MM-DD.log
      const logDir = loggingForm.logDir.replace(/\/+$/, "");
      const fullFile = `${logDir}/fgbg-YYYY-MM-DD.log`;

      if (!draft.logging) draft.logging = {};
      draft.logging.cacheTimeSecond = loggingForm.cacheTimeSecond;
      draft.logging.level = loggingForm.level;
      draft.logging.file = fullFile;
      draft.logging.consoleLevel = loggingForm.consoleLevel;
      draft.logging.consoleStyle = loggingForm.consoleStyle;
      draft.logging.allowModule = loggingForm.allowModule;

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

  const handleEvictLoggingCache = async () => {
    try {
      await evictLoggingCache();
      setMessage("日志配置缓存已清除，系统将重新读取配置。");
    } catch (error) {
      setMessage(`清除缓存失败: ${error.message}`);
    }
  };

  /** 与后端 testMemorySearchEmbedding 一致；remote 未填 model 时不覆盖后端已有值 */
  const handleTestMemorySearch = async () => {
    setMemorySearchTestFix(null);
    if (memoryHeartbeatForm.mode === "local") {
      if (!String(memoryHeartbeatForm.model || "").trim()) {
        setMemorySearchTestResult("error");
        setMemorySearchTestHint("本地模式请先填写嵌入模型（文件名或路径）。");
        setMemorySearchTestFix("local-download");
        return;
      }
    } else {
      if (!String(memoryHeartbeatForm.endpoint || "").trim()) {
        setMemorySearchTestResult("error");
        setMemorySearchTestHint("远程模式请先填写 endpoint。");
        setMemorySearchTestFix("remote-downgrade");
        return;
      }
      if (!String(memoryHeartbeatForm.apiKey || "").trim()) {
        setMemorySearchTestResult("error");
        setMemorySearchTestHint("远程模式请先填写 API Key。");
        setMemorySearchTestFix("remote-downgrade");
        return;
      }
    }
    setMemorySearchTesting(true);
    setMemorySearchTestResult(null);
    setMemorySearchTestHint("");
    try {
      const memorySearch = buildMemorySearchPayloadForTest(
        memoryHeartbeatForm,
        rawConfig,
      );
      const payload = await testMemorySearchConfig(memorySearch);
      const baseHint = `${payload.mode} · 维度 ${payload.dimensions} · ${payload.durationMs} ms`;
      setMemorySearchTestResult("success");
      setMemorySearchTestHint(
        payload.warning ? `${baseHint} · ${payload.warning}` : baseHint,
      );
      setMemorySearchTestFix(null);
    } catch (error) {
      setMemorySearchTestResult("error");
      setMemorySearchTestHint(error?.message || String(error));
      setMemorySearchTestFix(
        memoryHeartbeatForm.mode === "local"
          ? "local-download"
          : "remote-downgrade",
      );
    } finally {
      setMemorySearchTesting(false);
    }
  };

  const handleRepairLocalMemory = async () => {
    if (!rawConfig) return;
    const payload = buildMemorySearchPayloadForTest(
      { ...memoryHeartbeatForm, mode: "local" },
      rawConfig,
    );
    setMemorySearchRepairing(true);
    setMessage("");
    try {
      await repairLocalMemorySearch(payload);
      setMessage(
        "已按当前表单尝试下载/修复本地模型，完成后请再次点击「测试连接」。",
      );
      setMemorySearchTestFix(null);
    } catch (error) {
      setMemorySearchTestHint(error?.message || String(error));
    } finally {
      setMemorySearchRepairing(false);
    }
  };

  const handleDowngradeToLocal = () => {
    setMemoryHeartbeatForm((prev) => ({
      ...prev,
      mode: "local",
      model: LOCAL_MEMORY_MODEL,
      embeddingDimensions: LOCAL_EMBEDDING_DIMENSIONS,
    }));
    setMemorySearchTestResult(null);
    setMemorySearchTestHint("");
    setMemorySearchTestFix(null);
    setMessage("已切换为本地模式，请填写嵌入模型并保存后再测试。");
  };

  const handleSaveMemoryHeartbeat = async () => {
    if (!rawConfig || !baseConfig) return;
    if (memoryHeartbeatForm.mode === "remote") {
      if (!String(memoryHeartbeatForm.endpoint || "").trim()) {
        setMessage("远程模式下请填写 endpoint。");
        return;
      }
      if (!String(memoryHeartbeatForm.apiKey || "").trim()) {
        setMessage("远程模式下请填写 API Key。");
        return;
      }
    }
    if (memoryHeartbeatForm.mode === "local") {
      if (!String(memoryHeartbeatForm.model || "").trim()) {
        setMessage("本地模式下请填写嵌入模型。");
        return;
      }
      if (
        Number(memoryHeartbeatForm.embeddingDimensions) !==
        LOCAL_EMBEDDING_DIMENSIONS
      ) {
        setMessage(`本地模式下向量维度必须为 ${LOCAL_EMBEDDING_DIMENSIONS}。`);
        return;
      }
    }
    let allowedScriptsArr = [];
    try {
      const parsed = JSON.parse(memoryHeartbeatForm.allowedScripts || "[]");
      if (!Array.isArray(parsed)) throw new Error("not array");
      allowedScriptsArr = parsed;
    } catch {
      setMessage("「允许脚本」须为合法 JSON 数组。");
      return;
    }
    const intervalMs = Math.min(
      60000,
      Math.max(200, Number(memoryHeartbeatForm.intervalMs) || 1000),
    );
    const concurrency = Math.min(
      3,
      Math.max(1, Number(memoryHeartbeatForm.concurrency) || 1),
    );
    setMessage("");
    setSaving(true);
    try {
      const draft =
        typeof structuredClone === "function"
          ? structuredClone(rawConfig)
          : JSON.parse(JSON.stringify(rawConfig || {}));
      if (!draft.agents) draft.agents = {};
      draft.agents.memorySearch = buildMemorySearchForSave(
        memoryHeartbeatForm,
        rawConfig,
      );
      draft.heartbeat = {
        enabled: memoryHeartbeatForm.heartbeatEnabled,
        intervalMs,
        concurrency,
        allowedScripts: allowedScriptsArr,
      };
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
    // 找到未添加的内置供应商
    const currentIds = new Set(providers.map((p) => p.id));
    const availableBuiltin = builtinProviders.find(
      (p) => !currentIds.has(p.id),
    );

    if (availableBuiltin) {
      // 添加内置供应商
      const newProvider = {
        id: availableBuiltin.id,
        name: getProviderName(availableBuiltin.id, availableBuiltin),
        icon: getProviderIcon(availableBuiltin.id),
        enabled: true,
        featureCount: null,
        isBuiltin: true,
      };
      setProviders((prev) => [...prev, newProvider]);
      setSelectedProviderId(availableBuiltin.id);
      setDetailForm({
        modelName: availableBuiltin.models?.[0]?.id || "",
        apiKey: "",
        baseUrl: availableBuiltin.baseUrl || "",
        model: "",
      });
    } else {
      // 添加自定义供应商
      const newId = `provider-${Date.now()}`;
      const newProvider = {
        id: newId,
        name: "新提供商",
        icon: "⚙️",
        enabled: true,
        featureCount: null,
        isBuiltin: false,
      };
      setProviders((prev) => [...prev, newProvider]);
      setSelectedProviderId(newId);
      setDetailForm({
        modelName: "",
        apiKey: "",
        baseUrl: "",
        model: "",
      });
    }
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
      ) : activeTab === "memoryHeartbeat" ? (
        <div className="settings-memory-heartbeat-layout">
          <div className="settings-memory-heartbeat-panel">
            <div className="settings-memory-heartbeat-columns">
              <section className="settings-memory-heartbeat-pane">
                <div className="settings-memory-heartbeat-pane-header">
                  <h2>记忆检索</h2>
                  <p className="settings-logging-desc">
                    配置向量记忆嵌入。本地使用 GGUF；远程为 OpenAI 兼容
                    embeddings API。测试连接在「模式」右侧。
                  </p>
                </div>
                <div className="settings-detail-form">
                  <div className="settings-form-group settings-memory-mode-group">
                    <label className="settings-form-label">模式</label>
                    <div className="settings-memory-mode-row">
                      <select
                        className="settings-form-input settings-form-select"
                        value={memoryHeartbeatForm.mode}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMemorySearchTestResult(null);
                          setMemorySearchTestHint("");
                          setMemorySearchTestFix(null);
                          setMemoryHeartbeatForm((prev) =>
                            v === "local"
                              ? {
                                  ...prev,
                                  mode: "local",
                                  model: LOCAL_MEMORY_MODEL,
                                  embeddingDimensions:
                                    LOCAL_EMBEDDING_DIMENSIONS,
                                }
                              : {
                                  ...prev,
                                  mode: "remote",
                                  model:
                                    rawConfig?.agents?.memorySearch?.model ??
                                    "",
                                  embeddingDimensions:
                                    typeof rawConfig?.agents?.memorySearch
                                      ?.embeddingDimensions === "number"
                                      ? rawConfig.agents.memorySearch
                                          .embeddingDimensions
                                      : prev.embeddingDimensions,
                                },
                          );
                        }}
                      >
                        <option value="local">本地 (local)</option>
                        <option value="remote">远程 (remote)</option>
                      </select>
                      <button
                        type="button"
                        className="settings-test-btn"
                        onClick={handleTestMemorySearch}
                        disabled={memorySearchTesting}
                      >
                        {memorySearchTesting ? "测试中…" : "测试连接"}
                      </button>
                    </div>
                    {memorySearchTestResult === "success" ? (
                      <p
                        className="settings-memory-test-inline-ok"
                        role="status"
                      >
                        <Check size={14} /> {memorySearchTestHint}
                      </p>
                    ) : null}
                  </div>

                  {memorySearchTestResult === "error" &&
                  memorySearchTestHint ? (
                    <div className="settings-memory-test-error-panel">
                      <p className="settings-memory-test-error-text">
                        {memorySearchTestHint}
                      </p>
                      <div className="settings-memory-test-error-actions">
                        {memorySearchTestFix === "local-download" ? (
                          <button
                            type="button"
                            className="settings-test-btn"
                            onClick={handleRepairLocalMemory}
                            disabled={memorySearchRepairing}
                          >
                            {memorySearchRepairing
                              ? "处理中…"
                              : "下载 / 修复本地模型"}
                          </button>
                        ) : null}
                        {memorySearchTestFix === "remote-downgrade" ? (
                          <button
                            type="button"
                            className="settings-test-btn"
                            onClick={handleDowngradeToLocal}
                          >
                            切换为本地模式
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {memoryHeartbeatForm.mode === "local" ? (
                    <>
                      <div className="settings-form-group">
                        <label className="settings-form-label">
                          嵌入模型 <span className="settings-required">*</span>
                        </label>
                        <input
                          type="text"
                          className="settings-form-input"
                          value={memoryHeartbeatForm.model}
                          onChange={(e) =>
                            setMemoryHeartbeatForm((prev) => ({
                              ...prev,
                              model: e.target.value,
                            }))
                          }
                          placeholder={LOCAL_MEMORY_MODEL}
                        />
                        <p className="settings-form-hint">
                          填写 GGUF
                          文件名（如默认模型名）或本机路径；测试前必填。
                        </p>
                      </div>
                      <div className="settings-form-group">
                        <label className="settings-form-label">向量维度</label>
                        <input
                          type="number"
                          className="settings-form-input"
                          value={LOCAL_EMBEDDING_DIMENSIONS}
                          readOnly
                          disabled
                        />
                        <p className="settings-form-hint">
                          本地模式固定为 {LOCAL_EMBEDDING_DIMENSIONS}
                          ，保存时会校验该值。
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="settings-form-group">
                        <label className="settings-form-label">
                          远程 endpoint{" "}
                          <span className="settings-required">*</span>
                        </label>
                        <input
                          type="url"
                          className="settings-form-input"
                          value={memoryHeartbeatForm.endpoint}
                          onChange={(e) =>
                            setMemoryHeartbeatForm((prev) => ({
                              ...prev,
                              endpoint: e.target.value,
                            }))
                          }
                          placeholder="https://api.example.com/v1/embeddings"
                        />
                      </div>
                      <div className="settings-form-group">
                        <label className="settings-form-label">
                          API Key <span className="settings-required">*</span>
                        </label>
                        <div className="settings-form-input-row">
                          <input
                            type={showMemoryApiKey ? "text" : "password"}
                            className="settings-form-input"
                            value={memoryHeartbeatForm.apiKey}
                            onChange={(e) =>
                              setMemoryHeartbeatForm((prev) => ({
                                ...prev,
                                apiKey: e.target.value,
                              }))
                            }
                            placeholder="远程嵌入服务 API Key"
                            autoComplete="off"
                          />
                        </div>
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={showMemoryApiKey}
                            onChange={(e) =>
                              setShowMemoryApiKey(e.target.checked)
                            }
                          />
                          显示 API Key
                        </label>
                      </div>
                      <div className="settings-form-group">
                        <label className="settings-form-label">
                          嵌入模型名（可选）
                        </label>
                        <input
                          type="text"
                          className="settings-form-input"
                          value={memoryHeartbeatForm.model}
                          onChange={(e) =>
                            setMemoryHeartbeatForm((prev) => ({
                              ...prev,
                              model: e.target.value,
                            }))
                          }
                          placeholder="不填则沿用已保存配置中的模型名"
                        />
                        <p className="settings-form-hint">
                          留空不会清空服务端已有
                          model，保存与测试均与磁盘配置合并。
                        </p>
                      </div>
                      <div className="settings-form-group">
                        <label className="settings-form-label">向量维度</label>
                        <input
                          type="number"
                          className="settings-form-input"
                          min={1}
                          value={memoryHeartbeatForm.embeddingDimensions}
                          onChange={(e) =>
                            setMemoryHeartbeatForm((prev) => ({
                              ...prev,
                              embeddingDimensions: Number(e.target.value) || 1,
                            }))
                          }
                        />
                      </div>
                    </>
                  )}

                  <div className="settings-form-group">
                    <label className="settings-form-label">
                      chunk 最大字符数
                    </label>
                    <input
                      type="number"
                      className="settings-form-input"
                      min={1}
                      value={memoryHeartbeatForm.chunkMaxChars}
                      onChange={(e) =>
                        setMemoryHeartbeatForm((prev) => ({
                          ...prev,
                          chunkMaxChars: Number(e.target.value) || 1,
                        }))
                      }
                    />
                  </div>

                  {memoryHeartbeatForm.mode === "local" ? (
                    <CollapsibleSection title="模型下载" defaultOpen={false}>
                      <div className="settings-form-group settings-form-group--toggle-row">
                        <label className="settings-form-label">
                          允许自动下载模型
                        </label>
                        <ToggleSwitch
                          checked={memoryHeartbeatForm.downloadEnabled}
                          onChange={(v) =>
                            setMemoryHeartbeatForm((prev) => ({
                              ...prev,
                              downloadEnabled: v,
                            }))
                          }
                        />
                      </div>
                      <div className="settings-form-group">
                        <label className="settings-form-label">
                          模型下载地址
                        </label>
                        <input
                          type="url"
                          className="settings-form-input"
                          value={memoryHeartbeatForm.downloadUrl}
                          onChange={(e) =>
                            setMemoryHeartbeatForm((prev) => ({
                              ...prev,
                              downloadUrl: e.target.value,
                            }))
                          }
                          placeholder="https://..."
                        />
                      </div>
                      <div className="settings-form-group">
                        <label className="settings-form-label">
                          下载超时 (ms)
                        </label>
                        <input
                          type="number"
                          className="settings-form-input"
                          min={1000}
                          value={memoryHeartbeatForm.downloadTimeout}
                          onChange={(e) =>
                            setMemoryHeartbeatForm((prev) => ({
                              ...prev,
                              downloadTimeout: Number(e.target.value) || 1000,
                            }))
                          }
                        />
                      </div>
                    </CollapsibleSection>
                  ) : null}
                </div>
              </section>

              <section className="settings-memory-heartbeat-pane">
                <div className="settings-memory-heartbeat-pane-header">
                  <h2>任务心跳</h2>
                  <p className="settings-logging-desc">
                    定时扫描计划任务（watch-dog）：调度开关、间隔、并发与允许执行的脚本白名单（对应{" "}
                    <code className="settings-inline-code">heartbeat</code>{" "}
                    配置）。
                  </p>
                </div>
                <div className="settings-detail-form">
                  <div className="settings-form-group settings-form-group--toggle-row">
                    <label className="settings-form-label">启用心跳调度</label>
                    <ToggleSwitch
                      checked={memoryHeartbeatForm.heartbeatEnabled}
                      onChange={(v) =>
                        setMemoryHeartbeatForm((prev) => ({
                          ...prev,
                          heartbeatEnabled: v,
                        }))
                      }
                    />
                  </div>
                  <div className="settings-form-group">
                    <label className="settings-form-label">心跳间隔 (ms)</label>
                    <input
                      type="number"
                      className="settings-form-input"
                      min={200}
                      max={60000}
                      value={memoryHeartbeatForm.intervalMs}
                      onChange={(e) =>
                        setMemoryHeartbeatForm((prev) => ({
                          ...prev,
                          intervalMs: Number(e.target.value) || 200,
                        }))
                      }
                    />
                    <p className="settings-form-hint">有效范围 200～60000</p>
                  </div>
                  <div className="settings-form-group">
                    <label className="settings-form-label">并发数</label>
                    <input
                      type="number"
                      className="settings-form-input"
                      min={1}
                      max={3}
                      value={memoryHeartbeatForm.concurrency}
                      onChange={(e) =>
                        setMemoryHeartbeatForm((prev) => ({
                          ...prev,
                          concurrency: Number(e.target.value) || 1,
                        }))
                      }
                    />
                    <p className="settings-form-hint">有效范围 1～3</p>
                  </div>
                  <div className="settings-form-group">
                    <label className="settings-form-label">
                      允许脚本（JSON 数组）
                    </label>
                    <textarea
                      className="settings-form-input settings-form-textarea"
                      value={memoryHeartbeatForm.allowedScripts}
                      onChange={(e) =>
                        setMemoryHeartbeatForm((prev) => ({
                          ...prev,
                          allowedScripts: e.target.value,
                        }))
                      }
                      placeholder='["one_minute_heartbeat"]'
                      rows={4}
                    />
                  </div>
                </div>
              </section>
            </div>

            <div className="settings-memory-heartbeat-footer">
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
                    onClick={handleSaveMemoryHeartbeat}
                    disabled={saving || resetting}
                  >
                    {saving ? "保存中..." : "保存修改"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : activeTab === "logging" ? (
        <div className="settings-logging-layout">
          {/* Top: Log configuration — blends with background */}
          <div className="settings-logging-config">
            <div className="settings-logging-config-header">
              <div>
                <h2>日志配置</h2>
                <p className="settings-logging-desc">
                  配置日志文件的输出路径、日志级别以及控制台输出格式。
                </p>
              </div>
              <div className="settings-logging-config-actions">
                <button
                  type="button"
                  className="settings-evict-btn"
                  onClick={handleEvictLoggingCache}
                  disabled={evictingCache || saving}
                  title="强制刷新：清除日志配置缓存，通知 logging 子系统重新读取配置"
                >
                  <RefreshCw
                    size={16}
                    className={evictingCache ? "spinning" : ""}
                  />
                  <span>强制刷新</span>
                </button>

                <button
                  type="button"
                  className="settings-logging-expand-btn"
                  onClick={() => setLoggingConfigExpanded((v) => !v)}
                >
                  {loggingConfigExpanded ? "收起配置" : "展开配置"}
                </button>
              </div>
            </div>

            {loggingConfigExpanded ? (
              <>
                <div className="settings-logging-fields">
                  {/* 日志等级 — 带颜色色块 */}
                  <div className="settings-form-group">
                    <label className="settings-form-label">日志等级</label>
                    <div className="settings-log-level-grid">
                      {[
                        { value: "trace", label: "Trace", color: "#94a3b8" },
                        {
                          value: "debug",
                          label: "Debug",
                          color: "#60a5fa",
                        },
                        { value: "info", label: "Info", color: "#34d399" },
                        { value: "warn", label: "Warn", color: "#fbbf24" },
                        { value: "error", label: "Error", color: "#f87171" },
                        { value: "fatal", label: "Fatal", color: "#dc2626" },
                        {
                          value: "silent",
                          label: "Silent",
                          color: "#6b7280",
                        },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`settings-log-level-chip ${
                            loggingForm.level === opt.value ? "selected" : ""
                          }`}
                          style={{
                            "--chip-color": opt.color,
                          }}
                          onClick={() =>
                            setLoggingForm((prev) => ({
                              ...prev,
                              level: opt.value,
                            }))
                          }
                        >
                          <span
                            className="settings-log-level-dot"
                            style={{ background: opt.color }}
                          />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 日志文件路径 — 只显示目录 */}
                  <div className="settings-form-group">
                    <label className="settings-form-label">
                      日志目录
                      <span
                        className="settings-field-hint-wrap"
                        title="日志将输出到该目录下的 fgbg-YYYY-MM-DD.log 文件"
                      >
                        <HelpCircle size={14} />
                      </span>
                    </label>
                    <input
                      type="text"
                      className="settings-form-input"
                      value={loggingForm.logDir}
                      onChange={(e) =>
                        setLoggingForm((prev) => ({
                          ...prev,
                          logDir: e.target.value,
                        }))
                      }
                      placeholder="/tmp/fgbg"
                    />
                  </div>

                  {/* 缓存时间 */}
                  <div className="settings-form-group">
                    <label className="settings-form-label">
                      缓存时间（秒）
                      <span
                        className="settings-field-hint-wrap"
                        title="系统会缓存日志配置以避免每次打印都读取配置。此值控制缓存过期时间。"
                      >
                        <HelpCircle size={14} />
                      </span>
                    </label>
                    <input
                      type="number"
                      className="settings-form-input"
                      value={loggingForm.cacheTimeSecond}
                      onChange={(e) =>
                        setLoggingForm((prev) => ({
                          ...prev,
                          cacheTimeSecond: Number(e.target.value),
                        }))
                      }
                      min={60}
                      max={300}
                    />
                  </div>

                  {/* 控制台日志等级 */}
                  <div className="settings-form-group">
                    <label className="settings-form-label">
                      控制台日志等级
                      <span
                        className="settings-field-hint-wrap"
                        title="低于此等级的日志将不会输出到控制台。"
                      >
                        <HelpCircle size={14} />
                      </span>
                    </label>
                    <select
                      className="settings-form-input settings-form-select"
                      value={loggingForm.consoleLevel}
                      onChange={(e) =>
                        setLoggingForm((prev) => ({
                          ...prev,
                          consoleLevel: e.target.value,
                        }))
                      }
                    >
                      {[
                        "debug",
                        "info",
                        "warn",
                        "error",
                        "fatal",
                        "silent",
                      ].map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 控制台输出样式 */}
                  <div className="settings-form-group">
                    <label className="settings-form-label">
                      控制台输出样式
                      <span
                        className="settings-field-hint-wrap"
                        title="pretty：带颜色和格式化的可读输出；common：简化输出；json：JSON 格式输出。"
                      >
                        <HelpCircle size={14} />
                      </span>
                    </label>
                    <select
                      className="settings-form-input settings-form-select"
                      value={loggingForm.consoleStyle}
                      onChange={(e) =>
                        setLoggingForm((prev) => ({
                          ...prev,
                          consoleStyle: e.target.value,
                        }))
                      }
                    >
                      {["pretty", "common", "json"].map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 允许模块 — 复选框 */}
                  <div className="settings-form-group">
                    <label className="settings-form-label">允许模块</label>
                    <div className="settings-module-checkboxes">
                      <label className="settings-module-checkbox">
                        <input
                          type="checkbox"
                          checked={loggingForm.allowModule.includes("*")}
                          onChange={(e) => {
                            setLoggingForm((prev) => ({
                              ...prev,
                              allowModule: e.target.checked ? ["*"] : [],
                            }));
                          }}
                        />
                        *（全部）
                      </label>
                      {!loggingForm.allowModule.includes("*") &&
                        [
                          "auth",
                          "agent",
                          "qq",
                          "watch-dog",
                          "memory",
                          "tool",
                        ].map((mod) => (
                          <label key={mod} className="settings-module-checkbox">
                            <input
                              type="checkbox"
                              checked={loggingForm.allowModule.includes(mod)}
                              onChange={(e) => {
                                setLoggingForm((prev) => ({
                                  ...prev,
                                  allowModule: e.target.checked
                                    ? [...prev.allowModule, mod]
                                    : prev.allowModule.filter((m) => m !== mod),
                                }));
                              }}
                            />
                            {mod}
                          </label>
                        ))}
                    </div>
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
                      onClick={handleSaveLogging}
                      disabled={saving || resetting}
                    >
                      {saving ? "保存中..." : "保存修改"}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {/* Bottom: Log search panel */}
          <div className="settings-logging-search">
            <div className="settings-logging-search-header">
              <h2>日志搜索</h2>
            </div>
            <div className="settings-logging-search-body">
              <div className="settings-logging-search-filters">
                <div className="settings-form-group">
                  <label className="settings-form-label">关键词</label>
                  <input
                    type="text"
                    className="settings-form-input"
                    placeholder="输入关键词搜索日志"
                  />
                </div>
                <div className="settings-form-group">
                  <label className="settings-form-label">日志等级</label>
                  <select className="settings-form-input settings-form-select">
                    <option value="">全部</option>
                    <option value="trace">Trace</option>
                    <option value="debug">Debug</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                    <option value="fatal">Fatal</option>
                  </select>
                </div>
                <div className="settings-form-group">
                  <label className="settings-form-label">模块</label>
                  <select className="settings-form-input settings-form-select">
                    <option value="">全部</option>
                    <option value="auth">auth</option>
                    <option value="agent">agent</option>
                    <option value="qq">qq</option>
                    <option value="watch-dog">watch-dog</option>
                    <option value="memory">memory</option>
                    <option value="tool">tool</option>
                  </select>
                </div>
              </div>
              <div className="settings-logging-search-results">
                <div className="settings-logging-search-empty">
                  <p>输入关键词后点击搜索查看日志</p>
                </div>
              </div>
            </div>
          </div>
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
