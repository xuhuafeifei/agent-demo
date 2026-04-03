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
import { X } from "lucide-react";
import {
  TABS,
  LOCAL_MEMORY_MODEL,
  LOCAL_EMBEDDING_DIMENSIONS,
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
  const [formErrors, setFormErrors] = useState({});
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
    setFormErrors((prev) => ({ ...prev, [field]: false }));
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

    // Validation
    const errors = {};
    if (!detailForm.baseUrl.trim()) {
      errors.baseUrl = true;
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setMessage("请填写所有必填字段。");
      return;
    }

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

  const handleSaveChannels = async () => {
    if (!rawConfig || !baseConfig) return;
    // Validation
    if (channelsForm.qqbotEnabled) {
      if (!channelsForm.qqbotAppId.trim()) {
        setMessage("开启 QQBot 通道时，AppId 不能为空。");
        return;
      }
      if (!channelsForm.qqbotClientSecret.trim()) {
        setMessage("开启 QQBot 通道时，Client Secret 不能为空。");
        return;
      }
    }
    setMessage("");
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
      setMessage("保存成功。");
    } catch (error) {
      setMessage(`保存失败: ${error.message}`);
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
            handleEvictLoggingCache,
            evictingCache,
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
    </section>
  );
}
