import { useEffect, useMemo, useState, useRef } from "react";
import {
  getFgbgConfig,
  patchFgbgConfig,
  resetFgbgConfig,
  getProviderModels,
  getSupportedModelProviders,
  getConfiguredProviders,
  evictLoggingCache,
  startQwenPortalOAuth,
  pollQwenPortalOAuth,
  testMemorySearchConfig,
  repairLocalMemorySearch,
  getDefaultModelProvider,
  testModelConnection,
  getQwenPortalCredentials,
} from "../api/configApi";
import MessageManager from "./Message";
import { X } from "lucide-react";
import {
  TABS,
  LOCAL_MEMORY_MODEL,
  LOCAL_EMBEDDING_DIMENSIONS,
  getDefaultModelForProvider,
  getProviderModelOptions,
} from "./settings/constants";
import {
  buildMemorySearchPayloadForTest,
  buildMemorySearchForSave,
} from "./settings/memorySearchPayload";
import {
  deepDiff,
  getProviderIcon,
  getProviderName,
} from "./settings/settingsUtils";
import SetModelPage from "./settings/SetModelPage";
import SetMemoryAndHeartPage from "./settings/SetMemoryAndHeartPage";
import SetLoggingPage from "./settings/SetLoggingPage";
import SetChannelsPage from "./settings/SetChannelsPage";
import ProviderSelectorModal from "./settings/ProviderSelectorModal";

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
  // 日志配置过长：默认收起，仅保留简短配置头；用户可展开查看更多配置项
  const [loggingConfigExpanded, setLoggingConfigExpanded] = useState(false);

  // Channels config state
  const [channelsForm, setChannelsForm] = useState({
    qqbotEnabled: false,
    qqbotAppId: "",
    qqbotClientSecret: "",
    qqbotTargetOpenid: "",
    qqbotAccounts: "",
  });
  const [showQqbotSecret, setShowQqbotSecret] = useState(false);

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
  /** model：与 ModelCombobox 绑定，保存/测试均只用此字段 → fgbg.json providers[].models[].id */
  const [detailForm, setDetailForm] = useState({
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
  const [formErrors, setFormErrors] = useState({});
  const mountedRef = useRef(true);
  const modelAutoFilledRef = useRef(false);

  // Provider selector modal state
  const [showProviderModal, setShowProviderModal] = useState(false);

  // Model list from backend
  const [modelOptions, setModelOptions] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Built-in providers from backend
  const [builtinProviders, setBuiltinProviders] = useState([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [defaultProviderId, setDefaultProviderId] = useState(null);

  // Load config
  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
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

        // Sync channels form from config
        const channels = payload.config?.channels || {};
        const qqbot = channels.qqbot || {};
        setChannelsForm({
          qqbotEnabled: qqbot.enabled ?? false,
          qqbotAppId: qqbot.appId ?? "",
          qqbotClientSecret: qqbot.clientSecret ?? "",
          qqbotTargetOpenid: qqbot.targetOpenid ?? "",
          qqbotAccounts: Array.isArray(qqbot.accounts)
            ? JSON.stringify(qqbot.accounts, null, 2)
            : "",
        });
      } catch (error) {
        if (mounted) MessageManager.info(`加载配置失败: ${error.message}`);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // 合并已配置的 providers（只显示 fgbg.json 中已配置的，不显示 implicit 模板）
  useEffect(() => {
    if (!rawConfig) return;
    const modelsConfig = rawConfig.models || {};
    const providerEntries = Object.entries(modelsConfig.providers || {});
    
    // 只显示已配置的 provider
    const configuredIds = new Set(providerEntries.map(([id]) => id));
    
    const loaded = Array.from(configuredIds).map((id) => {
      const cfg = modelsConfig.providers?.[id];
      const builtinInfo = builtinProviders.find((p) => p.id === id);
      const hasApiKey = cfg?.apiKey && cfg.apiKey.trim().length > 0;
      
      return {
        id,
        name: getProviderName(id, builtinInfo),
        icon: getProviderIcon(id),
        enabled: cfg?.enabled !== false,
        featureCount: cfg?.featureCount || null,
        isBuiltin: !!builtinInfo,
        hasApiKey,
      };
    });
    
    setProviders(loaded.length ? loaded : []);
    setSelectedProviderId((prev) => {
      if (prev && loaded.some((p) => p.id === prev)) return prev;
      // 优先选中后端返回的默认 provider
      if (defaultProviderId && loaded.some((p) => p.id === defaultProviderId)) {
        return defaultProviderId;
      }
      // 其次选中第一个有 apiKey 的 provider
      const firstWithKey = loaded.find((p) => p.hasApiKey);
      if (firstWithKey) return firstWithKey.id;
      return loaded[0]?.id ?? null;
    });
  }, [rawConfig, builtinProviders, defaultProviderId]);

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
        setBuiltinProviders(payload.templates || []);
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

  // Load default provider from backend
  useEffect(() => {
    let mounted = true;
    async function loadDefaultProvider() {
      try {
        const payload = await getDefaultModelProvider();
        if (!mounted) return;
        const newDefaultId = payload.defaultProvider || null;
        setDefaultProviderId(newDefaultId);
      } catch (error) {
        if (mounted) {
          console.error("Failed to load default provider:", error);
        }
      }
    }
    loadDefaultProvider();
    return () => {
      mounted = false;
    };
  }, []);

  // 当 defaultProviderId 加载完成后，自动切换到默认 provider
  useEffect(() => {
    if (defaultProviderId && providers.length > 0) {
      setSelectedProviderId((prev) => {
        // 如果默认值存在且当前没选中或选中的是 fallback 的，切换到默认值
        if (providers.some((p) => p.id === defaultProviderId)) {
          return defaultProviderId;
        }
        return prev;
      });
    }
  }, [defaultProviderId, providers]);

  // Load model options when provider changes (use frontend maintained list)
  useEffect(() => {
    if (!selectedProviderId) {
      setModelOptions([]);
      modelAutoFilledRef.current = false;
      return;
    }
    
    // Use frontend maintained model list
    const frontendModels = getProviderModelOptions(selectedProviderId);
    
    if (frontendModels.length > 0) {
      setModelOptions(frontendModels);
      // 自动选中第一个模型
      if (!modelAutoFilledRef.current) {
        const firstModelId = frontendModels[0].id;
        setDetailForm((prev) => ({ ...prev, model: firstModelId }));
        modelAutoFilledRef.current = true;
      }
    } else {
      // Fallback to backend if not maintained in frontend
      let cancelled = false;
      async function loadModels() {
        setLoadingModels(true);
        try {
          const res = await getProviderModels(selectedProviderId);
          if (!cancelled && res.models) {
            setModelOptions(res.models);
            // 自动填充第一个模型的 id（与 ModelCombobox 同源）
            if (res.models.length > 0 && !modelAutoFilledRef.current) {
              const firstModelId = res.models[0].id;
              setDetailForm((prev) => ({ ...prev, model: firstModelId }));
              modelAutoFilledRef.current = true;
            }
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
    }
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
    const firstModelId = providerCfg.models?.[0]?.id || "";
    const modelToUse =
      firstModelId || getDefaultModelForProvider(selectedProviderId);
    
    // qwen-portal oauth 模式：从 auth-profile.json 读取凭证
    const isQwenOAuth = selectedProviderId === "qwen-portal" && !providerCfg.apiKey;
    
    async function loadDetailForm() {
      // qwen-portal OAuth 模式从认证文件读取
      let baseUrl = providerCfg.baseUrl || "";
      
      if (isQwenOAuth) {
        try {
          const res = await getQwenPortalCredentials();
          if (res.success && res.resourceUrl) {
            baseUrl = res.resourceUrl;
          }
        } catch (err) {
          console.error("Failed to load OAuth credentials:", err);
        }
      }
      
      setDetailForm({
        apiKey: providerCfg.apiKey || "",
        baseUrl,
        model: modelToUse,
      });
      
      setShowApiKey(false);
      setConnectionResult(null);
      setQwenAuthHint("");
      modelAutoFilledRef.current = false;
      
      if (selectedProviderId === "qwen-portal") {
        const auth = providerCfg.auth;
        if (auth === "oauth") {
          setQwenCredentialMode("oauth");
        } else if (auth === "api-key") {
          setQwenCredentialMode("manual");
        } else {
          setQwenCredentialMode(
            String(providerCfg.apiKey || "").trim() ? "manual" : "oauth",
          );
        }
      }
    }

    loadDetailForm();
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
    setFormErrors((prev) => ({ ...prev, [field]: false }));
  };

  /** qwen-portal：切换认证方式时清空 OAuth 模式下不应提交的 API Key */
  const handleQwenCredentialModeChange = (mode) => {
    setQwenCredentialMode(mode);
    setQwenAuthHint("");
    setConnectionResult(null);
    if (mode === "oauth") {
      setDetailForm((prev) => ({ ...prev, apiKey: "" }));
    }
  };

  const handleTestConnection = async () => {
    const modelForRequest = String(detailForm.model ?? "").trim();
    if (!modelForRequest) {
      setConnectionResult("error");
      MessageManager.error("请填写或选择模型后再测试连接。");
      return;
    }

    const isQwenOAuth =
      selectedProviderId === "qwen-portal" && qwenCredentialMode === "oauth";
    const needBaseUrl = !isQwenOAuth;
    if (needBaseUrl && !detailForm.baseUrl) {
      setConnectionResult("error");
      MessageManager.error("请填写 Base URL 后再测试连接。");
      return;
    }

    if (!isQwenOAuth && !detailForm.apiKey) {
      setConnectionResult("error");
      MessageManager.error("请填写 API Key 后再测试连接。");
      return;
    }

    setTestingConnection(true);
    setConnectionResult(null);

    try {
      const payload = {
        model: modelForRequest,
        providerId: selectedProviderId,
        baseUrl: needBaseUrl ? detailForm.baseUrl : detailForm.baseUrl || "",
      };
      if (selectedProviderId === "qwen-portal") {
        payload.qwenCredentialType =
          qwenCredentialMode === "oauth" ? "oauth" : "api_key";
      }
      if (!isQwenOAuth) {
        payload.apiKey = detailForm.apiKey;
      }

      const result = await testModelConnection(payload);

      if (result.success) {
        setConnectionResult("success");
        MessageManager.success("连接测试成功！");
      } else {
        setConnectionResult("error");
        MessageManager.error(`连接失败: ${result.error}`);
      }
    } catch (error) {
      setConnectionResult("error");
      MessageManager.error(`连接测试异常: ${error.message}`);
    } finally {
      setTestingConnection(false);
    }
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

          setDetailForm((prev) => ({
            ...prev,
            apiKey: "",
            baseUrl: poll.resourceUrl || prev.baseUrl,
          }));
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

    const builtinInfo = builtinProviders.find(
      (p) => p.id === selectedProviderId,
    );
    const isQwenOAuthSave =
      selectedProviderId === "qwen-portal" && qwenCredentialMode === "oauth";

    let baseUrlForSave =
      detailForm.baseUrl.trim() ||
      String(builtinInfo?.baseUrl ?? "").trim() ||
      "";

    if (isQwenOAuthSave && !baseUrlForSave) {
      try {
        const res = await getQwenPortalCredentials();
        if (res.success && res.resourceUrl) {
          baseUrlForSave = String(res.resourceUrl).trim();
        }
      } catch {
        /* ignore */
      }
    }

    const errors = {};
    if (!detailForm.model?.trim()) {
      errors.model = true;
    }
    if (!baseUrlForSave.trim()) {
      errors.baseUrl = true;
    }

    if (!isQwenOAuthSave && !detailForm.apiKey.trim()) {
      errors.apiKey = true;
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      MessageManager.error(
        isQwenOAuthSave
          ? "请填写模型名称；若 Base URL 为空，请先完成 Qwen 授权或填写地址。"
          : "请填写所有必填字段（模型名称、Base URL、API Key）",
      );
      return;
    }

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

      // ModelCombobox 的 model → 写入 fgbg.json 里该 provider 的 models[].id（首项为主模型）
      const modelIdToUse = String(detailForm.model ?? "").trim();

      // 对于内置供应商，保留其默认的 models 配置
      const updatedModels =
        builtinInfo?.models?.length > 0
          ? builtinInfo.models.map((m, i) =>
              i === 0 ? { ...m, id: modelIdToUse || m.id } : m,
            )
          : existingModels.length > 0
            ? existingModels.map((m, i) =>
                i === 0 ? { ...m, id: modelIdToUse || m.id } : m,
              )
            : modelIdToUse
              ? [{ id: modelIdToUse }]
              : [];

      const apiKeyForSave =
        selectedProviderId === "qwen-portal" && qwenCredentialMode === "oauth"
          ? ""
          : detailForm.apiKey;

      const providerDraft = {
        baseUrl: baseUrlForSave,
        apiKey: apiKeyForSave,
        api:
          draft.models.providers[selectedProviderId]?.api ||
          builtinInfo?.api ||
          "openai-completions",
        models: updatedModels,
        enabled: selectedProvider?.enabled !== false,
      };
      if (selectedProviderId === "qwen-portal") {
        providerDraft.auth = isQwenOAuthSave ? "oauth" : "api-key";
      }
      draft.models.providers[selectedProviderId] = providerDraft;

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
      MessageManager.success("保存成功");
    } catch (error) {
      MessageManager.error(`保存失败: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLogging = async () => {
    if (!rawConfig || !baseConfig) return;
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
      
      // 保存成功后自动刷新日志配置缓存
      await evictLoggingCache();
      
      MessageManager.success("保存成功");
    } catch (error) {
      MessageManager.error(`保存失败: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveChannels = async () => {
    if (!rawConfig || !baseConfig) return;
    // Validation
    if (channelsForm.qqbotEnabled) {
      if (!channelsForm.qqbotAppId.trim()) {
        MessageManager.info("开启 QQBot 通道时，AppId 不能为空。");
        return;
      }
      if (!channelsForm.qqbotClientSecret.trim()) {
        MessageManager.info("开启 QQBot 通道时，Client Secret 不能为空。");
        return;
      }
    }
    setSaving(true);
    try {
      const draft =
        typeof structuredClone === "function"
          ? structuredClone(rawConfig)
          : JSON.parse(JSON.stringify(rawConfig || {}));

      let accountsArr = null;
      if (channelsForm.qqbotAccounts.trim()) {
        try {
          accountsArr = JSON.parse(channelsForm.qqbotAccounts);
          if (!Array.isArray(accountsArr)) accountsArr = null;
        } catch {
          accountsArr = null;
        }
      }

      if (!draft.channels) draft.channels = {};
      draft.channels.qqbot = {
        enabled: channelsForm.qqbotEnabled,
        appId: channelsForm.qqbotAppId.trim(),
        clientSecret: channelsForm.qqbotClientSecret,
        targetOpenid: channelsForm.qqbotTargetOpenid.trim() || undefined,
        accounts: accountsArr,
      };

      const patch = deepDiff(draft, baseConfig);
      if (patch && Object.keys(patch).length > 0) {
        const payload = await patchFgbgConfig(patch);
        setRawConfig(payload.config);
        setBaseConfig(payload.config);
        setMetadata(payload.metadata || {});
      }
      MessageManager.success("保存成功");
    } catch (error) {
      MessageManager.error(`保存失败: ${error.message}`);
    } finally {
      setSaving(false);
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
    try {
      await repairLocalMemorySearch(payload);
      MessageManager.success("已按当前表单尝试下载/修复本地模型，完成后请再次点击「测试连接」。");
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
    MessageManager.info("已切换为本地模式，请填写嵌入模型并保存后再测试。");
  };

  const handleSaveMemoryHeartbeat = async () => {
    if (!rawConfig || !baseConfig) return;
    if (memoryHeartbeatForm.mode === "remote") {
      if (!String(memoryHeartbeatForm.endpoint || "").trim()) {
        MessageManager.info("远程模式下请填写 endpoint。");
        return;
      }
      if (!String(memoryHeartbeatForm.apiKey || "").trim()) {
        MessageManager.info("远程模式下请填写 API Key。");
        return;
      }
    }
    if (memoryHeartbeatForm.mode === "local") {
      if (!String(memoryHeartbeatForm.model || "").trim()) {
        MessageManager.info("本地模式下请填写嵌入模型。");
        return;
      }
      if (
        Number(memoryHeartbeatForm.embeddingDimensions) !==
        LOCAL_EMBEDDING_DIMENSIONS
      ) {
        MessageManager.info(`本地模式下向量维度必须为 ${LOCAL_EMBEDDING_DIMENSIONS}。`);
        return;
      }
    }
    let allowedScriptsArr = [];
    try {
      const parsed = JSON.parse(memoryHeartbeatForm.allowedScripts || "[]");
      if (!Array.isArray(parsed)) throw new Error("not array");
      allowedScriptsArr = parsed;
    } catch {
      MessageManager.info("「允许脚本」须为合法 JSON 数组。");
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
      MessageManager.success("保存成功");
    } catch (error) {
      MessageManager.error(`保存失败: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const payload = await resetFgbgConfig();
      setRawConfig(payload.config);
      setBaseConfig(payload.config);
      setMetadata(payload.metadata || {});
      MessageManager.success("已恢复默认配置");
    } catch (error) {
      MessageManager.error(`恢复默认失败: ${error.message}`);
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
    setShowProviderModal(true);
  };

  const handleProviderSelect = ({ type, id }) => {
    setShowProviderModal(false);

    if (type === "builtin" && id) {
      // 添加内置供应商
      const builtinInfo = builtinProviders.find((p) => p.id === id);
      const newProvider = {
        id,
        name: getProviderName(id, builtinInfo),
        icon: getProviderIcon(id),
        enabled: true,
        featureCount: null,
        isBuiltin: true,
      };
      setProviders((prev) => [...prev, newProvider]);
      setSelectedProviderId(id);
      const firstBuiltinModel = builtinInfo?.models?.[0]?.id || "";
      setDetailForm({
        apiKey: "",
        baseUrl: builtinInfo?.baseUrl || "",
        model: firstBuiltinModel,
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
        apiKey: "",
        baseUrl: "",
        model: "",
      });
    }
  };

  const handleProviderModalClose = () => {
    setShowProviderModal(false);
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
        <SetModelPage
          modelTab={{
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
            formErrors,
          }}
        />
      ) : activeTab === "memoryHeartbeat" ? (
        <SetMemoryAndHeartPage
          memoryTab={{
            rawConfig,
            memoryHeartbeatForm,
            setMemoryHeartbeatForm,
            setMemorySearchTestResult,
            setMemorySearchTestHint,
            setMemorySearchTestFix,
            handleTestMemorySearch,
            memorySearchTesting,
            memorySearchTestResult,
            memorySearchTestHint,
            memorySearchTestFix,
            handleRepairLocalMemory,
            memorySearchRepairing,
            handleDowngradeToLocal,
            showMemoryApiKey,
            setShowMemoryApiKey,
            handleSaveMemoryHeartbeat,
            handleResetClick,
            saving,
            resetting,
          }}
        />
      ) : activeTab === "logging" ? (
        <SetLoggingPage
          loggingTab={{
            saving,
            loggingConfigExpanded,
            setLoggingConfigExpanded,
            loggingForm,
            setLoggingForm,
            resetting,
            handleResetClick,
            handleSaveLogging,
          }}
        />
      ) : (
        <SetChannelsPage
          channelsTab={{
            channelsForm,
            setChannelsForm,
            showQqbotSecret,
            setShowQqbotSecret,
            saving,
            resetting,
            handleResetClick,
            handleSaveChannels,
          }}
        />
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

      {/* Provider selector modal */}
      {showProviderModal ? (
        <ProviderSelectorModal
          builtinTemplates={builtinProviders}
          currentProviderIds={new Set(providers.map((p) => p.id))}
          onSelect={handleProviderSelect}
          onClose={handleProviderModalClose}
        />
      ) : null}
    </section>
  );
}
