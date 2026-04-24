import { useState, useEffect } from "react";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Settings,
  Plus,
  X,
  AlertTriangle,
} from "lucide-react";
import {
  toolSecurityApi,
  type ToolSecurityConfig,
  type ToolMode,
} from "../api/toolSecurity";
import "../styles/tool-security.css";

// 支持审批的工具列表（固定）
const APPROVAL_SUPPORTED_TOOLS = ["read", "write", "shellExecute"];

const PRESET_INFO = {
  safety: {
    label: "Safety",
    description: "最小权限，仅日常对话",
    icon: ShieldCheck,
    color: "preset-safety",
  },
  guard: {
    label: "Guard",
    description: "平衡权限，默认推荐",
    icon: Shield,
    color: "preset-guard",
  },
  yolo: {
    label: "Yolo",
    description: "完全信任，包含 shell 执行",
    icon: ShieldOff,
    color: "preset-yolo",
  },
  custom: {
    label: "Custom",
    description: "自定义配置",
    icon: Settings,
    color: "preset-custom",
  },
};

export default function ToolSecurityPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switchingPreset, setSwitchingPreset] = useState(false);
  const [presetSwitched, setPresetSwitched] = useState(false); // 标记是否切换了预设
  const [showPresetModal, setShowPresetModal] = useState(false); // 显示切换预设的弹窗
  const [pendingPreset, setPendingPreset] = useState<ToolMode | null>(null); // 待切换的预设
  const [config, setConfig] = useState<ToolSecurityConfig | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [newDenyPath, setNewDenyPath] = useState("");
  const [choosableTools, setChoosableTools] = useState<string[]>([]);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const data = await toolSecurityApi.getConfig();
      setChoosableTools(data.choosableTools || []);
      const configData = {
        ...data.config,
        denyPaths:
          typeof data.config.denyPaths === "string"
            ? data.config.denyPaths
            : Array.isArray(data.config.denyPaths)
              ? data.config.denyPaths.join("\n")
              : "",
      };
      setConfig(configData);
    } catch (error: any) {
      console.error("加载工具安全配置失败:", error);
      setMessage({ text: `加载配置失败: ${error.message}`, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    try {
      setSaving(true);

      // 内置模式只传递 preset 字段，custom 模式传递完整配置
      const saveData =
        config.preset !== "custom" ? { preset: config.preset } : config;

      await toolSecurityApi.saveConfig(saveData as any);
      setPresetSwitched(false); // 保存成功后重置标记
      setMessage({ text: "配置保存成功", type: "success" });
      setTimeout(() => setMessage(null), 3000);
    } catch (error: any) {
      setMessage({ text: `保存失败: ${error.message}`, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      const data = await toolSecurityApi.resetConfig();
      setChoosableTools(data.choosableTools || []);
      setConfig({
        ...data.config,
        denyPaths:
          typeof data.config.denyPaths === "string"
            ? data.config.denyPaths
            : "",
      });
      setMessage({ text: "已重置为默认配置", type: "success" });
      setTimeout(() => setMessage(null), 3000);
    } catch (error: any) {
      setMessage({ text: `重置失败: ${error.message}`, type: "error" });
    }
  };

  /** 请求切换内置模式：弹出确认弹窗 */
  const handleSwitchPreset = async (preset: ToolMode) => {
    if (preset === config?.preset) return;
    setPendingPreset(preset);
    setShowPresetModal(true);
  };

  /** 确认切换内置模式 */
  const confirmSwitchPreset = async () => {
    if (!pendingPreset || !config) return;
    const preset = pendingPreset;

    setShowPresetModal(false);
    setPendingPreset(null);

    if (preset === config.preset) return;

    try {
      setSwitchingPreset(true);
      const data = await toolSecurityApi.importFromPreset(preset);
      setConfig({
        ...data.config,
        preset: preset, // 保持内置模式名（safety/guard/yolo）
        denyPaths:
          typeof data.config.denyPaths === "string"
            ? data.config.denyPaths
            : "",
      });
      setPresetSwitched(true); // 标记已切换预设
      setMessage({
        text: `已切换到 ${PRESET_INFO[preset].label} 内置模式，请点击保存按钮应用`,
        type: "success",
      });
      setTimeout(() => setMessage(null), 3000);
    } catch (error: any) {
      setMessage({ text: `切换模式失败: ${error.message}`, type: "error" });
    } finally {
      setSwitchingPreset(false);
    }
  };

  /** 取消切换内置模式 */
  const cancelSwitchPreset = () => {
    setShowPresetModal(false);
    setPendingPreset(null);
  };

  const handleImportPreset = async (preset: ToolMode) => {
    try {
      const data = await toolSecurityApi.importFromPreset(preset);
      setConfig({
        ...data.config,
        preset: "custom",
        denyPaths:
          typeof data.config.denyPaths === "string"
            ? data.config.denyPaths
            : "",
      });
      setImportModalOpen(false);
      setMessage({
        text: `已导入 ${PRESET_INFO[preset].label} 预设配置到 Custom 模式`,
        type: "success",
      });
      setTimeout(() => setMessage(null), 3000);
    } catch (error: any) {
      setMessage({ text: `导入失败: ${error.message}`, type: "error" });
    }
  };

  const toggleTool = (toolName: string) => {
    if (!config || config.preset !== "custom") return;
    const enabledTools = config.enabledTools.includes(toolName)
      ? config.enabledTools.filter((t) => t !== toolName)
      : [...config.enabledTools, toolName];
    setConfig({ ...config, enabledTools });
  };

  const toggleApprovalTool = (toolName: string) => {
    if (!config || config.preset !== "custom") return;
    // 只允许切换支持审批的工具
    if (!APPROVAL_SUPPORTED_TOOLS.includes(toolName)) return;
    const requireApprovalFor = config.approval.requireApprovalFor.includes(
      toolName,
    )
      ? config.approval.requireApprovalFor.filter((t) => t !== toolName)
      : [...config.approval.requireApprovalFor, toolName];
    setConfig({
      ...config,
      approval: { ...config.approval, requireApprovalFor },
    });
  };

  const addDenyPath = () => {
    if (!config || !newDenyPath.trim()) return;
    const paths = (typeof config.denyPaths === "string"
      ? config.denyPaths.split("\n")
      : config.denyPaths
    ).filter((p) => p.trim());
    if (paths.includes(newDenyPath.trim())) return;
    paths.push(newDenyPath.trim());
    setConfig({ ...config, denyPaths: paths.join("\n") });
    setNewDenyPath("");
  };

  const removeDenyPath = (pathToRemove: string) => {
    if (!config) return;
    const paths = (typeof config.denyPaths === "string"
      ? config.denyPaths.split("\n")
      : config.denyPaths
    ).filter((p) => p.trim() && p !== pathToRemove);
    setConfig({ ...config, denyPaths: paths.join("\n") });
  };

  if (loading) {
    return <div className="tool-security-loading">加载中...</div>;
  }

  if (!config) {
    return <div className="tool-security-error">配置加载失败</div>;
  }

  const isReadOnly = config.preset !== "custom";
  const toolsToShow =
    choosableTools.length > 0 ? choosableTools : config.enabledTools;

  return (
    <div className="tool-security-page">
      {/* Preset Switch Confirmation Modal */}
      {showPresetModal && pendingPreset && (
        <div
          className="tool-security-modal-overlay"
          onClick={cancelSwitchPreset}
        >
          <div
            className="tool-security-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tool-security-modal-icon">
              <AlertTriangle size={48} />
            </div>
            <h2 className="tool-security-modal-title">切换内置模式</h2>
            <p className="tool-security-modal-message">
              确定要切换到 <strong>{PRESET_INFO[pendingPreset].label}</strong>{" "}
              模式吗？
            </p>
            <div className="tool-security-modal-warning">
              ⚠️ 切换后必须点击<span className="highlight-save">保存按钮</span>
              才能生效！
            </div>
            <div className="tool-security-modal-actions">
              <button
                className="tool-security-btn tool-security-btn-cancel"
                onClick={cancelSwitchPreset}
              >
                取消
              </button>
              <button
                className="tool-security-btn tool-security-btn-confirm"
                onClick={confirmSwitchPreset}
              >
                切换
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="tool-security-header">
        <h2>工具安全配置</h2>
        <div className="tool-security-actions">
          <button
            className="tool-security-btn tool-security-btn-reset"
            onClick={handleReset}
          >
            重置
          </button>
          <button
            className="tool-security-btn tool-security-btn-save"
            onClick={handleSave}
            disabled={saving || (isReadOnly && !presetSwitched)}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`tool-security-message tool-security-message-${message.type}`}
        >
          {message.text}
        </div>
      )}

      {isReadOnly && (
        <div className="tool-security-warning">
          <AlertTriangle size={18} />
          <span>
            当前为 <strong>{PRESET_INFO[config.preset]?.label}</strong>{" "}
            内置模式，不允许手动修改。
            {config.preset !== "custom" && (
              <button
                className="tool-security-link-btn"
                onClick={() => handleSwitchPreset("custom")}
              >
                切换到 Custom 模式
              </button>
            )}
          </span>
        </div>
      )}

      {/* Preset selector */}
      <div className="tool-security-section">
        <div className="tool-security-section-header">
          <h3>内置模式</h3>
          {presetSwitched && (
            <span className="tool-security-save-hint">
              ✓ 切换后需要保存才能生效
            </span>
          )}
        </div>
        <div className="tool-security-presets">
          {(Object.keys(PRESET_INFO) as ToolMode[]).map((preset) => {
            const info = PRESET_INFO[preset];
            const Icon = info.icon;
            return (
              <button
                key={preset}
                className={`tool-security-preset-card ${info.color} ${config.preset === preset ? "active" : ""}`}
                onClick={() => handleSwitchPreset(preset)}
                disabled={switchingPreset}
              >
                <Icon size={24} />
                <span className="preset-label">{info.label}</span>
                <span className="preset-desc">{info.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Import from preset (only in custom mode) */}
      {config.preset === "custom" && (
        <div className="tool-security-section">
          <h3>导入预设配置</h3>
          <div className="tool-security-import-row">
            <button
              className="tool-security-btn tool-security-btn-import"
              onClick={() => setImportModalOpen(true)}
            >
              从预设导入
            </button>
          </div>
        </div>
      )}

      {/* Enabled Tools */}
      <div className="tool-security-section">
        <h3>启用的工具</h3>
        <div className="tool-security-tools-grid">
          {toolsToShow.map((tool) => (
            <label
              key={tool}
              className={`tool-security-tool-checkbox ${isReadOnly ? "disabled" : ""}`}
            >
              <input
                type="checkbox"
                checked={config.enabledTools.includes(tool)}
                onChange={() => toggleTool(tool)}
                disabled={isReadOnly}
              />
              <span className="checkbox-label">{tool}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Access Configuration */}
      <div className="tool-security-section">
        <h3>访问范围</h3>
        <div className="tool-security-form-group">
          <label className="tool-security-form-label">作用域范围</label>
          <select
            className="tool-security-form-select"
            value={config.access.scope}
            onChange={(e) =>
              setConfig({
                ...config,
                access: { ...config.access, scope: e.target.value as any },
              })
            }
            disabled={isReadOnly}
          >
            <option value="workspace">仅工作区（workspace）</option>
            <option value="user-home">工作区 + 用户目录（user-home）</option>
            <option value="system">系统范围（system）</option>
          </select>
        </div>
        <div className="tool-security-form-row">
          <label className="tool-security-toggle-label">
            <input
              type="checkbox"
              checked={config.access.allowHiddenFiles}
              onChange={(e) =>
                setConfig({
                  ...config,
                  access: {
                    ...config.access,
                    allowHiddenFiles: e.target.checked,
                  },
                })
              }
              disabled={isReadOnly}
            />
            允许访问隐藏文件
          </label>
          <label className="tool-security-toggle-label">
            <input
              type="checkbox"
              checked={config.access.allowSymlinks}
              onChange={(e) =>
                setConfig({
                  ...config,
                  access: { ...config.access, allowSymlinks: e.target.checked },
                })
              }
              disabled={isReadOnly}
            />
            允许跟随符号链接
          </label>
        </div>
      </div>

      {/* Approval Configuration */}
      <div className="tool-security-section">
        <h3>审批确认</h3>
        <div className="tool-security-form-row">
          <label className="tool-security-toggle-label">
            <input
              type="checkbox"
              checked={config.approval.enabled}
              onChange={(e) =>
                setConfig({
                  ...config,
                  approval: { ...config.approval, enabled: e.target.checked },
                })
              }
              disabled={isReadOnly}
            />
            启用工具审批确认
          </label>
        </div>
        {config.approval.enabled && (
          <div className="tool-security-approval-tools">
            <label className="tool-security-form-label">
              需要审批的工具（仅支持 read, write, shellExecute）
            </label>
            <div className="tool-security-tools-grid">
              {APPROVAL_SUPPORTED_TOOLS.filter((t) =>
                toolsToShow.includes(t),
              ).map((tool) => (
                <label key={tool} className="tool-security-tool-checkbox">
                  <input
                    type="checkbox"
                    checked={config.approval.requireApprovalFor.includes(tool)}
                    onChange={() => toggleApprovalTool(tool)}
                    disabled={isReadOnly}
                  />
                  <span className="checkbox-label">{tool}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="tool-security-form-group">
          <label className="tool-security-form-label">审批超时（毫秒）</label>
          <input
            type="number"
            className="tool-security-form-input"
            value={config.approval.timeoutMs}
            onChange={(e) =>
              setConfig({
                ...config,
                approval: {
                  ...config.approval,
                  timeoutMs: parseInt(e.target.value) || 300000,
                },
              })
            }
            disabled={isReadOnly}
          />
        </div>
        <div className="tool-security-form-group">
          <label className="tool-security-form-label">
            不可审批时的策略（QQ 等无法交互的渠道）
          </label>
          <select
            className="tool-security-form-select"
            value={config.unapprovableStrategy || "reject"}
            onChange={(e) =>
              setConfig({
                ...config,
                unapprovableStrategy: e.target.value as any,
              })
            }
            disabled={isReadOnly}
          >
            <option value="reject">拒绝执行（默认）</option>
            <option value="skip">跳过审批直接执行</option>
          </select>
          <p className="tool-security-form-hint">
            当通过 QQ 等无法交互的渠道触发工具时，若工具需要审批但无法交互，按此策略处理。
          </p>
        </div>
      </div>

      {/* Deny Paths */}
      <div className="tool-security-section">
        <h3>拒绝路径</h3>
        <div className="tool-security-deny-paths">
          <div className="tool-security-deny-paths-input">
            <input
              type="text"
              className="tool-security-form-input"
              placeholder="输入拒绝路径，如 ~/.ssh/**"
              value={newDenyPath}
              onChange={(e) => setNewDenyPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDenyPath()}
              disabled={isReadOnly}
            />
            <button
              className="tool-security-btn tool-security-btn-add-path"
              onClick={addDenyPath}
              disabled={isReadOnly}
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="tool-security-deny-paths-list">
            {(typeof config.denyPaths === "string"
              ? config.denyPaths.split("\n")
              : config.denyPaths
            )
              .filter((p) => p.trim())
              .map((path) => (
                <div key={path} className="tool-security-deny-path-item">
                  <code>{path}</code>
                  <button
                    className="tool-security-btn-remove"
                    onClick={() => removeDenyPath(path)}
                    disabled={isReadOnly}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Import Modal */}
      {importModalOpen && (
        <div
          className="tool-security-modal-overlay"
          onClick={() => setImportModalOpen(false)}
        >
          <div
            className="tool-security-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tool-security-modal-header">
              <h3>从预设导入</h3>
              <button
                className="tool-security-modal-close"
                onClick={() => setImportModalOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="tool-security-modal-body">
              <p className="tool-security-modal-hint">
                选择要导入的预设配置，当前自定义配置将被覆盖。
              </p>
              <div className="tool-security-modal-presets">
                {(["safety", "guard", "yolo"] as ToolMode[]).map((preset) => {
                  const info = PRESET_INFO[preset];
                  const Icon = info.icon;
                  return (
                    <button
                      key={preset}
                      className={`tool-security-modal-preset-btn ${info.color}`}
                      onClick={() => handleImportPreset(preset)}
                    >
                      <Icon size={20} />
                      <span>{info.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
