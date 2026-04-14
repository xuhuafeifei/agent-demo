import { useEffect, useMemo, useState, useRef } from "react";
import {
  resetFgbgConfig,
  resetFgbgConfigSection,
  weixinSetPrimary,
} from "../api/client";
import MessageManager from "./Message";
import { X } from "lucide-react";
import { TABS } from "./settings/constants";
import { deepDiff } from "./settings/settingsUtils";
import SetModelPage from "./settings/SetModelPage";
import SetMemoryAndHeartPage from "./settings/SetMemoryAndHeartPage";
import SetLoggingPage from "./settings/SetLoggingPage";
import SetChannelsPage from "./settings/SetChannelsPage";
import ToolSecurityPage from "./ToolSecurityPage";
import ProviderSelectorModal from "./settings/ProviderSelectorModal";
import { useConfigLoader } from "./settings/useConfigLoader";
import { useModelConfig } from "./settings/useModelConfig";
import { useSaveHandlers } from "./settings/useSaveHandlers";
import { useMemoryConfig } from "./settings/useMemoryConfig";

// ─── Main SettingsPage ──────────────────────────────────────────────
export default function SettingsPage() {
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("models");

  // Load all config state from hook
  const {
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
    defaultProviderId,
    loadingProviders,
  } = useConfigLoader();

  // Models tab state + handlers
  const {
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
    setQwenAuthHint,
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
  } = useModelConfig({ rawConfig, baseConfig, setRawConfig, setBaseConfig, setMetadata, providers, setProviders, selectedProviderId, setSelectedProviderId, builtinProviders });

  // Save handlers
  const { handleSaveLogging, handleSaveChannels } = useSaveHandlers({ rawConfig, baseConfig, setRawConfig, setBaseConfig, setMetadata, setSaving });

  // Memory/Heartbeat tab
  const {
    memoryHeartbeatForm,
    setMemoryHeartbeatForm,
    showMemoryApiKey,
    setShowMemoryApiKey,
    memorySearchTesting,
    memorySearchRepairing,
    memorySearchTestResult,
    setMemorySearchTestResult,
    memorySearchTestHint,
    setMemorySearchTestHint,
    memorySearchTestFix,
    setMemorySearchTestFix,
    handleTestMemorySearch,
    handleRepairLocalMemory,
    handleDowngradeToLocal,
    handleSaveMemoryHeartbeat,
  } = useMemoryConfig({ rawConfig, baseConfig, setRawConfig, setBaseConfig, setMetadata });

  // Reset handler
  const handleReset = async () => {
    setResetting(true);
    try {
      // 根据当前激活的 tab 决定恢复哪个部分
      // 定义 tab 到配置路径的映射
      const tabToSectionMap = {
        models: "models",
        memoryHeartbeat: null, // 特殊处理：需要恢复两个部分
        logging: "logging",
        channels: "channels.qqbot",
      };

      let payload;
      const section = tabToSectionMap[activeTab];

      if (activeTab === "memoryHeartbeat") {
        // 记忆与心跳：需要恢复 agents.memorySearch 和 heartbeat 两个部分
        await resetFgbgConfigSection("agents.memorySearch");
        payload = await resetFgbgConfigSection("heartbeat");
        MessageManager.success("已恢复记忆与心跳配置默认值");
      } else if (section) {
        // 其他单个配置模块
        payload = await resetFgbgConfigSection(section);
        const sectionName = {
          models: "模型",
          logging: "日志",
          channels: "通道",
        }[activeTab] || "配置";
        MessageManager.success(`已恢复${sectionName}配置默认值`);
      } else {
        // 降级：恢复整个配置
        payload = await resetFgbgConfig();
        MessageManager.success("已恢复默认配置");
      }
      setRawConfig(payload.config);
      setBaseConfig(payload.config);
      setMetadata(payload.metadata || {});
      setHasUnsavedChanges(false);
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

    // 校验：qwen-portal 不能删除
    if (selectedProviderId === "qwen-portal") {
      MessageManager.error("qwen-portal 是内置核心配置，不允许删除。");
      return;
    }

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
      const bm = builtinInfo?.models?.[0];
      setDetailForm({
        apiKey: "",
        baseUrl: builtinInfo?.baseUrl || "",
        model: firstBuiltinModel,
        maxTokens: bm?.maxTokens ?? "",
        tokenRatio: bm?.tokenRatio ?? "",
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
        maxTokens: "",
        tokenRatio: "",
      });
    }
  };

  const handleProviderModalClose = () => {
    setShowProviderModal(false);
  };

  // 切换供应商时检查未保存的更改
  const handleProviderSelectWithCheck = (id) => {
    if (hasUnsavedChanges && selectedProviderId) {
      if (
        window.confirm(
          `当前"${selectedProviderId}"的配置尚未保存，切换将丢失编辑的信息。是否继续？`,
        )
      ) {
        setSelectedProviderId(id);
        setHasUnsavedChanges(false);
      }
    } else {
      setSelectedProviderId(id);
    }
  };

  // 包装 setDetailForm，标记有未保存的更改
  const handleDetailChangeWithTrack = (field, value) => {
    setHasUnsavedChanges(true);
    handleDetailChange(field, value);
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
            setSelectedProviderId: handleProviderSelectWithCheck,
            handleProviderToggle,
            handleAddProvider,
            detailForm,
            handleDetailChange: handleDetailChangeWithTrack,
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
      ) : activeTab === "channels" ? (
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
      ) : activeTab === "toolSecurity" ? (
        <ToolSecurityPage />
      ) : null}

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
