// @ts-nocheck
import { useEffect, useState, useRef, useMemo } from "react";
import {
  getProviderModels,
  testModelConnection,
  startQwenPortalOAuth,
  pollQwenPortalOAuth,
  getQwenPortalCredentials,
  patchFgbgConfig,
} from "../../api/client";
import MessageManager from "../Message";
import {
  getDefaultModelForProvider,
  getProviderModelOptions,
} from "./constants";
import { deepDiff } from "./settingsUtils";

/**
 * Hook: Models tab 的状态和 handlers
 */
export function useModelConfig({ rawConfig, baseConfig, setRawConfig, setBaseConfig, setMetadata, providers, setProviders, selectedProviderId, setSelectedProviderId, builtinProviders }) {
  // State
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [detailForm, setDetailForm] = useState({
    apiKey: "",
    baseUrl: "",
    model: "",
    maxTokens: "",
    tokenRatio: "",
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState(null);
  const [qwenAuthBusy, setQwenAuthBusy] = useState(false);
  const [qwenAuthHint, setQwenAuthHint] = useState("");
  const [qwenCredentialMode, setQwenCredentialMode] = useState("oauth");
  const [formErrors, setFormErrors] = useState({});
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [modelOptions, setModelOptions] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const mountedRef = useRef(true);
  const modelAutoFilledRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load model options when provider changes
  useEffect(() => {
    if (!selectedProviderId) {
      setModelOptions([]);
      modelAutoFilledRef.current = false;
      return;
    }

    const frontendModels = getProviderModelOptions(selectedProviderId);
    if (frontendModels.length > 0) {
      setModelOptions(frontendModels);
      if (!modelAutoFilledRef.current) {
        const firstModelId = frontendModels[0].id;
        setDetailForm((prev) => ({ ...prev, model: firstModelId }));
        modelAutoFilledRef.current = true;
      }
    } else {
      let cancelled = false;
      async function loadModels() {
        setLoadingModels(true);
        try {
          const res = await getProviderModels(selectedProviderId);
          if (!cancelled && res.success && res.models) {
            setModelOptions(res.models);
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
      return () => { cancelled = true; };
    }
  }, [selectedProviderId]);

  // Sync detail form when selection changes
  useEffect(() => {
    if (!selectedProviderId || !rawConfig) return;
    const providerCfg = rawConfig?.models?.providers?.[selectedProviderId] || {};
    const firstModelId = providerCfg.models?.[0]?.id || "";
    const modelToUse = firstModelId || getDefaultModelForProvider(selectedProviderId);
    const modelRow = providerCfg.models?.find((m) => m.id === modelToUse) || providerCfg.models?.[0] || {};
    const resolvedMaxTokens = providerCfg.maxTokens !== undefined && providerCfg.maxTokens !== null ? providerCfg.maxTokens : modelRow.maxTokens;
    const resolvedTokenRatio = providerCfg.tokenRatio !== undefined && providerCfg.tokenRatio !== null ? providerCfg.tokenRatio : modelRow.tokenRatio;

    const isQwenOAuth = selectedProviderId === "qwen-portal" && !providerCfg.apiKey;

    async function loadDetailForm() {
      let baseUrl = providerCfg.baseUrl || "";
      if (isQwenOAuth) {
        try {
          const res = await getQwenPortalCredentials();
          if (res.success && res.resourceUrl) {
            baseUrl = res.resourceUrl;
          }
        } catch { /* ignore */ }
      }

      setDetailForm({
        apiKey: providerCfg.apiKey || "",
        baseUrl,
        model: modelToUse,
        maxTokens: resolvedMaxTokens !== undefined && resolvedMaxTokens !== null ? resolvedMaxTokens : "",
        tokenRatio: resolvedTokenRatio !== undefined && resolvedTokenRatio !== null ? resolvedTokenRatio : "",
      });
      setShowApiKey(false);
      setConnectionResult(null);
      setQwenAuthHint("");
      modelAutoFilledRef.current = false;

      if (selectedProviderId === "qwen-portal") {
        const auth = providerCfg.auth;
        if (auth === "oauth") setQwenCredentialMode("oauth");
        else if (auth === "api-key") setQwenCredentialMode("manual");
        else setQwenCredentialMode(String(providerCfg.apiKey || "").trim() ? "manual" : "oauth");
      }
    }
    loadDetailForm();
  }, [selectedProviderId, rawConfig]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId),
    [providers, selectedProviderId],
  );

  // Handlers
  const handleProviderToggle = (id, enabled) => {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));
  };

  const handleDetailChange = (field, value) => {
    setDetailForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "model" && selectedProviderId && rawConfig && typeof value === "string") {
        const providerCfg = rawConfig?.models?.providers?.[selectedProviderId] || {};
        const modelRow = providerCfg.models?.find((m) => m.id === value) || {};
        if (providerCfg.maxTokens !== undefined && providerCfg.maxTokens !== null) next.maxTokens = providerCfg.maxTokens;
        else if (modelRow.maxTokens !== undefined && modelRow.maxTokens !== null) next.maxTokens = modelRow.maxTokens;
        if (providerCfg.tokenRatio !== undefined && providerCfg.tokenRatio !== null) next.tokenRatio = providerCfg.tokenRatio;
        else if (modelRow.tokenRatio !== undefined && modelRow.tokenRatio !== null) next.tokenRatio = modelRow.tokenRatio;
      }
      return next;
    });
    setConnectionResult(null);
    setFormErrors((prev) => ({ ...prev, [field]: false }));
  };

  const handleQwenCredentialModeChange = (mode) => {
    setQwenCredentialMode(mode);
    setQwenAuthHint("");
    setConnectionResult(null);
    if (mode === "oauth") setDetailForm((prev) => ({ ...prev, apiKey: "" }));
  };

  const handleTestConnection = async () => {
    const modelForRequest = String(detailForm.model ?? "").trim();
    if (!modelForRequest) {
      setConnectionResult("error");
      MessageManager.error("请填写或选择模型后再测试连接。");
      return;
    }
    const isQwenOAuth = selectedProviderId === "qwen-portal" && qwenCredentialMode === "oauth";
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
        payload.qwenCredentialType = qwenCredentialMode === "oauth" ? "oauth" : "api_key";
      }
      if (!isQwenOAuth) payload.apiKey = detailForm.apiKey;

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

  const handleQwenPortalAuth = async () => {
    setQwenAuthBusy(true);
    setQwenAuthHint("");
    let intervalMs = 2000;
    try {
      const start = await startQwenPortalOAuth();
      if (!mountedRef.current) return;
      window.open(start.verificationUrl, "_blank", "noopener,noreferrer");
      setQwenAuthHint("已在浏览器中打开 Qwen 认证页，请完成登录；完成后此处会自动显示结果。");
      const deadline = Date.now() + (start.expiresIn ?? 900) * 1000;
      while (Date.now() < deadline && mountedRef.current) {
        await new Promise((r) => setTimeout(r, intervalMs));
        const poll = await pollQwenPortalOAuth(start.oauthSessionId);
        if (!mountedRef.current) return;
        if (poll.success && poll.status === "success") {
          setQwenAuthHint("授权成功，访问令牌已保存到本机");
          setConnectionResult("success");
          setQwenCredentialMode("oauth");
          setDetailForm((prev) => ({ ...prev, apiKey: "", baseUrl: poll.resourceUrl || prev.baseUrl }));
          return;
        }
        if (!poll.success || poll.status === "error") {
          setQwenAuthHint(poll.error || "授权未完成或失败，请重试。");
          setConnectionResult("error");
          return;
        }
        if (poll.slowDown) intervalMs = Math.min(intervalMs * 1.5, 10000);
      }
      if (mountedRef.current) setQwenAuthHint("授权等待超时，请重新点击「Qwen 授权」。");
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
    const builtinInfo = builtinProviders.find((p) => p.id === selectedProviderId);
    const isQwenOAuthSave = selectedProviderId === "qwen-portal" && qwenCredentialMode === "oauth";

    let baseUrlForSave = detailForm.baseUrl.trim() || String(builtinInfo?.baseUrl ?? "").trim() || "";
    if (isQwenOAuthSave && !baseUrlForSave) {
      try {
        const res = await getQwenPortalCredentials();
        if (res.success && res.resourceUrl) baseUrlForSave = String(res.resourceUrl).trim();
      } catch { /* ignore */ }
    }

    const errors = {};
    if (!detailForm.model?.trim()) errors.model = true;
    if (!baseUrlForSave.trim()) errors.baseUrl = true;
    if (!isQwenOAuthSave && !detailForm.apiKey.trim()) errors.apiKey = true;

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      MessageManager.error(isQwenOAuthSave ? "请填写模型名称；若 Base URL 为空，请先完成 Qwen 授权或填写地址。" : "请填写所有必填字段（模型名称、Base URL、API Key）");
      return;
    }

    try {
      const draft = typeof structuredClone === "function" ? structuredClone(rawConfig) : JSON.parse(JSON.stringify(rawConfig || {}));
      if (!draft.models) draft.models = {};
      if (!draft.models.providers) draft.models.providers = {};

      const existingModels = draft.models.providers[selectedProviderId]?.models || [];
      const modelIdToUse = String(detailForm.model ?? "").trim();
      const updatedModels = builtinInfo?.models?.length > 0
        ? builtinInfo.models.map((m, i) => i === 0 ? { ...m, id: modelIdToUse || m.id } : m)
        : existingModels.length > 0
          ? existingModels.map((m, i) => i === 0 ? { ...m, id: modelIdToUse || m.id } : m)
          : modelIdToUse ? [{ id: modelIdToUse }] : [];

      const apiKeyForSave = selectedProviderId === "qwen-portal" && qwenCredentialMode === "oauth" ? "" : detailForm.apiKey;
      const existingProvider = draft.models.providers[selectedProviderId] || {};
      const providerDraft = {
        ...existingProvider,
        baseUrl: baseUrlForSave,
        apiKey: apiKeyForSave,
        api: existingProvider.api || builtinInfo?.api || "openai-completions",
        models: updatedModels,
        enabled: selectedProvider?.enabled !== false,
      };

      const maxTokStr = String(detailForm.maxTokens ?? "").trim();
      const ratioStr = String(detailForm.tokenRatio ?? "").trim();
      if (maxTokStr !== "") { const n = parseInt(maxTokStr, 10); if (Number.isFinite(n)) providerDraft.maxTokens = n; }
      else delete providerDraft.maxTokens;
      if (ratioStr !== "") { const n = parseFloat(ratioStr); if (Number.isFinite(n)) providerDraft.tokenRatio = n; }
      else delete providerDraft.tokenRatio;

      if (selectedProviderId === "qwen-portal") providerDraft.auth = isQwenOAuthSave ? "oauth" : "api-key";
      draft.models.providers[selectedProviderId] = providerDraft;

      providers.forEach((p) => { if (draft.models.providers[p.id]) draft.models.providers[p.id].enabled = p.enabled; });
      const currentProviderIds = new Set(providers.map((p) => p.id));
      Object.keys(draft.models.providers).forEach((id) => { if (!currentProviderIds.has(id)) delete draft.models.providers[id]; });

      const patch = deepDiff(draft, baseConfig);
      if (patch && Object.keys(patch).length > 0) {
        const payload = await patchFgbgConfig(patch);
        setRawConfig(payload.config);
        setBaseConfig(payload.config);
        setMetadata(payload.metadata || {});
      }
      MessageManager.success("保存成功");
      setHasUnsavedChanges(false);
    } catch (error) {
      MessageManager.error(`保存失败: ${error.message}`);
    }
  };

  return {
    hasUnsavedChanges,
    setHasUnsavedChanges,
    detailForm,
    setDetailForm,
    showApiKey,
    setShowApiKey,
    testingConnection,
    connectionResult,
    setConnectionResult,
    qwenAuthBusy,
    qwenAuthHint,
    qwenCredentialMode,
    formErrors,
    showProviderModal,
    setShowProviderModal,
    modelOptions,
    loadingModels,
    selectedProvider,
    mountedRef,
    modelAutoFilledRef,
    handleProviderToggle,
    handleDetailChange,
    handleQwenCredentialModeChange,
    handleTestConnection,
    handleQwenPortalAuth,
    handleSave,
  };
}
