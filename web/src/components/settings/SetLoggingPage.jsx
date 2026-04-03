import { HelpCircle, RefreshCw } from "lucide-react";

export default function SetLoggingPage({ loggingTab }) {
  const {
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
  } = loggingTab;

  return (
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
                    ["auth", "agent", "qq", "watch-dog", "memory", "tool"].map(
                      (mod) => (
                        <label
                          key={mod}
                          className="settings-module-checkbox"
                        >
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
                      ),
                    )}
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
  );
}

