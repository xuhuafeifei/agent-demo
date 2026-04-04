// @ts-nocheck - Large component, will be gradually typed in Phase 4
import { Check } from "lucide-react";
import { CollapsibleSection, ToggleSwitch } from "./SettingsPrimitives";
import {
  LOCAL_EMBEDDING_DIMENSIONS,
  LOCAL_MEMORY_MODEL,
} from "./constants";

export default function SetMemoryAndHeartPage({ memoryTab }) {
  const {
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
  } = memoryTab;

  return (
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
                                rawConfig?.agents?.memorySearch?.model ?? "",
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

              {memorySearchTestResult === "error" && memorySearchTestHint ? (
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
                      填写 GGUF 文件名（如默认模型名）或本机路径；测试前必填。
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
                      本地模式固定为 {LOCAL_EMBEDDING_DIMENSIONS} ，保存时会校验该值。
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="settings-form-group">
                    <label className="settings-form-label">
                      远程 endpoint <span className="settings-required">*</span>
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
                        onChange={(e) => setShowMemoryApiKey(e.target.checked)}
                      />
                      显示 API Key
                    </label>
                  </div>
                  <div className="settings-form-group">
                    <label className="settings-form-label">嵌入模型名（可选）</label>
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
                      留空不会清空服务端已有 model，保存与测试均与磁盘配置合并。
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
                <label className="settings-form-label">chunk 最大字符数</label>
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
                    <label className="settings-form-label">允许自动下载模型</label>
                    <ToggleSwitch
                      checked={memoryHeartbeatForm.downloadEnabled}
                      onChange={(v) =>
                        setMemoryHeartbeatForm((prev) => ({
                          ...prev,
                          downloadEnabled: v,
                        }))
                      }
                      disabled={false}
                    />
                  </div>
                  <div className="settings-form-group">
                    <label className="settings-form-label">模型下载地址</label>
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
                    <label className="settings-form-label">下载超时 (ms)</label>
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
                <code className="settings-inline-code">heartbeat</code> 配置）。
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
                  disabled={false}
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
                <label className="settings-form-label">允许脚本（JSON 数组）</label>
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
  );
}

