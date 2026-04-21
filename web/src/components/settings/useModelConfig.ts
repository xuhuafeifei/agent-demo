// @ts-nocheck
import { useEffect, useState, useRef, useMemo } from "react";
import {
  getProviderModels,
  testModelConnection,
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

    setDetailForm({
      apiKey: providerCfg.apiKey || "",
      baseUrl: providerCfg.baseUrl || "",
      model: modelToUse,
      maxTokens: resolvedMaxTokens !== undefined && resolvedMaxTokens !== null ? resolvedMaxTokens : "",
      tokenRatio: resolvedTokenRatio !== undefined && resolvedTokenRatio !== null ? resolvedTokenRatio : "",
    });
    setShowApiKey(false);
    setConnectionResult(null);
    modelAutoFilledRef.current = false;
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

  const handleTestConnection = async () => {
    const modelForRequest = String(detailForm.model ?? "").trim();
    if (!modelForRequest) {
      setConnectionResult("error");
      MessageManager.error("请填写或选择模型后再测试连接。");
      return;
    }
    if (!detailForm.baseUrl) {
      setConnectionResult("error");
      MessageManager.error("请填写 Base URL 后再测试连接。");
      return;
    }
    if (!detailForm.apiKey) {
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
        baseUrl: detailForm.baseUrl,
        apiKey: detailForm.apiKey,
      };

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

  const handleSave = async () => {
    if (!rawConfig || !baseConfig || !selectedProviderId) return;
    const builtinInfo = builtinProviders.find((p) => p.id === selectedProviderId);

    const baseUrlForSave = detailForm.baseUrl.trim() || String(builtinInfo?.baseUrl ?? "").trim() || "";

    const errors = {};
    if (!detailForm.model?.trim()) errors.model = true;
    if (!baseUrlForSave.trim()) errors.baseUrl = true;
    if (!detailForm.apiKey.trim()) errors.apiKey = true;

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      MessageManager.error("请填写所有必填字段（模型名称、Base URL、API Key）");
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

      const existingProvider = draft.models.providers[selectedProviderId] || {};
      const providerDraft = {
        ...existingProvider,
        baseUrl: baseUrlForSave,
        apiKey: detailForm.apiKey,
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

      if (selectedProviderId === "qwen-portal") providerDraft.auth = "api-key";
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
    handleTestConnection,
    handleSave,
  };
}
