// @ts-nocheck
import { useEffect, useState, useRef } from "react";
import { getFgbgConfig, getSupportedModelProviders, getDefaultModelProvider } from "../../api/client";
import MessageManager from "../Message";
import {
  getProviderIcon,
  getProviderName,
} from "./settingsUtils";

/**
 * Hook: 加载 fgbg 配置 + 内置供应商 + 默认模型
 */
export function useConfigLoader() {
  const [loading, setLoading] = useState(true);
  const [rawConfig, setRawConfig] = useState(null);
  const [baseConfig, setBaseConfig] = useState(null);
  const [metadata, setMetadata] = useState(null);

  // Logging form
  const [loggingForm, setLoggingForm] = useState({
    cacheTimeSecond: 300,
    level: "info",
    logDir: "/tmp/fgbg",
    consoleLevel: "debug",
    consoleStyle: "pretty",
    allowModule: [],
  });
  const [loggingConfigExpanded, setLoggingConfigExpanded] = useState(false);

  // Channels form
  const [channelsForm, setChannelsForm] = useState({
    qqbotEnabled: false,
    qqbotAppId: "",
    qqbotClientSecret: "",
    qqbotHasCredentials: false,
    weixinEnabled: false,
    weixinPrimaryPending: "",
  });
  const [showQqbotSecret, setShowQqbotSecret] = useState(false);

  // Providers state
  const [providers, setProviders] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState(null);
  const [builtinProviders, setBuiltinProviders] = useState([]);
  const [defaultProviderId, setDefaultProviderId] = useState(null);
  const [loadingProviders, setLoadingProviders] = useState(false);

  const builtinProvidersRef = useRef([]);
  builtinProvidersRef.current = builtinProviders;
  const defaultProviderIdRef = useRef(null);
  defaultProviderIdRef.current = defaultProviderId;

  // Load main config
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

        // Sync logging form
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

        // Sync channels form
        const channels = payload.config?.channels || {};
        const qqbot = channels.qqbot || {};
        const weixin = channels.weixin || {};
        setChannelsForm({
          qqbotEnabled: qqbot.enabled ?? false,
          qqbotAppId: qqbot.appId ?? "",
          qqbotClientSecret: qqbot.clientSecret ?? "",
          qqbotHasCredentials: qqbot.hasCredentials ?? false,
          weixinEnabled: weixin.enabled ?? false,
          weixinPrimaryPending: "",
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

  // Build providers list from rawConfig
  useEffect(() => {
    if (!rawConfig) return;
    const modelsConfig = rawConfig.models || {};
    const providerEntries = Object.entries(modelsConfig.providers || {});
    const configuredIds = new Set(providerEntries.map(([id]) => id));
    const bp = builtinProvidersRef.current;
    const def = defaultProviderIdRef.current;

    const loaded = Array.from(configuredIds).map((id) => {
      const cfg = modelsConfig.providers?.[id];
      const builtinInfo = bp.find((p) => p.id === id);
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
      if (def && loaded.some((p) => p.id === def)) return def;
      const firstWithKey = loaded.find((p) => p.hasApiKey);
      if (firstWithKey) return firstWithKey.id;
      return loaded[0]?.id ?? null;
    });
  }, [rawConfig]);

  // Patch provider names when builtin providers arrive
  useEffect(() => {
    if (!builtinProviders.length) return;
    setProviders((prev) =>
      prev.map((p) => {
        const builtinInfo = builtinProviders.find((x) => x.id === p.id);
        return {
          ...p,
          name: getProviderName(p.id, builtinInfo),
          isBuiltin: !!builtinInfo,
        };
      }),
    );
  }, [builtinProviders]);

  // Load builtin providers
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
          console.error("Failed to load builtin providers:", error);
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

  // Load default provider
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

  // Fallback to default provider when selection is invalid
  useEffect(() => {
    if (!defaultProviderId) return;
    setSelectedProviderId((prev) => {
      if (prev && providers.some((p) => p.id === prev)) return prev;
      if (providers.some((p) => p.id === defaultProviderId)) return defaultProviderId;
      const firstWithKey = providers.find((p) => p.hasApiKey);
      return firstWithKey?.id ?? providers[0]?.id ?? null;
    });
  }, [defaultProviderId, providers.length]);

  return {
    loading,
    rawConfig,
    setRawConfig,
    baseConfig,
    setBaseConfig,
    metadata,
    setMetadata,
    loggingForm,
    setLoggingForm,
    loggingConfigExpanded,
    setLoggingConfigExpanded,
    channelsForm,
    setChannelsForm,
    showQqbotSecret,
    setShowQqbotSecret,
    providers,
    setProviders,
    selectedProviderId,
    setSelectedProviderId,
    builtinProviders,
    setBuiltinProviders,
    defaultProviderId,
    setDefaultProviderId,
    loadingProviders,
  };
}
