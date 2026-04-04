import { HelpCircle } from "lucide-react";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";

// 日志等级列表
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];

// 日志等级颜色
const LEVEL_COLORS = {
  trace: "#6b7280",
  debug: "#3b82f6",
  info: "#10b981",
  warn: "#f59e0b",
  error: "#ef4444",
  fatal: "#8b5cf6",
};

// 默认最大保存日志条数
const DEFAULT_MAX_LOG_COUNT = 800;

export default function SetLoggingPage({ loggingTab }) {
  const {
    saving,
    loggingConfigExpanded,
    setLoggingConfigExpanded,
    loggingForm,
    setLoggingForm,
    resetting,
    handleResetClick,
    handleSaveLogging,
  } = loggingTab;

  // 日志状态
  const [selectedLevel, setSelectedLevel] = useState("debug");
  const [selectedModule, setSelectedModule] = useState("");
  const [keyword, setKeyword] = useState("");
  const [logEntries, setLogEntries] = useState([]);
  const [offset, setOffset] = useState(0);
  const [lastLineNum, setLastLineNum] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true); // 跟踪用户是否在底部
  const [maxLogCount, setMaxLogCount] = useState(DEFAULT_MAX_LOG_COUNT);
  const tableContainerRef = useRef(null); // 日志列表固定高度区域的滚动容器
  const pollingTimerRef = useRef(null);

  // 读取最大日志条数配置
  useEffect(() => {
    const saved = localStorage.getItem("logViewerMaxCount");
    if (saved) {
      setMaxLogCount(parseInt(saved, 10));
    }
  }, []);

  // 保存最大日志条数配置
  const handleMaxLogCountChange = (value) => {
    const count = Math.max(100, Math.min(2000, parseInt(value, 10) || DEFAULT_MAX_LOG_COUNT));
    setMaxLogCount(count);
    localStorage.setItem("logViewerMaxCount", count.toString());
  };

  // 获取日志数据
  const fetchLogs = useCallback(async (level, currentOffset, limit = 20) => {
    try {
      const params = new URLSearchParams({
        level,
        offset: currentOffset.toString(),
        limit: limit.toString(),
      });
      const response = await fetch(`/api/config/logging/entries?${params}`);
      const data = await response.json();
      if (data.success) {
        return data.entries;
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    }
    return [];
  }, []);

  // 根据行号查找已存在的日志索引
  const findEntryByLineNum = useCallback((entries, lineNum) => {
    return entries.findIndex((entry) => entry.lineNum === lineNum);
  }, []);

  // 初始加载日志（切换等级时）
  const loadInitialLogs = useCallback(async (level) => {
    // 加载最新的 maxLogCount 条日志
    const entries = await fetchLogs(level, 0, maxLogCount);
    setLogEntries(entries);
    if (entries.length > 0) {
      setLastLineNum(entries[entries.length - 1].lineNum);
      setOffset(entries.length);
    } else {
      setLastLineNum(0);
      setOffset(0);
    }
  }, [fetchLogs, maxLogCount]);

  // 轮询新日志
  const pollNewLogs = useCallback(async () => {
    if (!lastLineNum) return;

    let currentOffset = 0;
    let batchSize = 20;
    let found = false;

    // 尝试 20, 40, 80 条
    for (const size of [20, 40, 80]) {
      const entries = await fetchLogs(selectedLevel, currentOffset, size);
      if (entries.length === 0) break;

      // 查找与 lastLineNum 匹配的行
      const matchIndex = findEntryByLineNum(entries, lastLineNum);
      if (matchIndex !== -1) {
        // 找到匹配，追加后续日志
        const newEntries = entries.slice(matchIndex + 1);
        if (newEntries.length > 0) {
          setLogEntries((prev) => {
            const combined = [...prev, ...newEntries];
            // 限制最大条数
            return combined.slice(-maxLogCount);
          });
          if (newEntries.length > 0) {
            setLastLineNum(newEntries[newEntries.length - 1].lineNum);
          }
        }
        found = true;
        break;
      }
      currentOffset += size;
    }

    // 如果 80 条都没找到，说明产生了超过 80 条新日志，重新加载
    if (!found) {
      await loadInitialLogs(selectedLevel);
    }
  }, [selectedLevel, lastLineNum, fetchLogs, findEntryByLineNum, loadInitialLogs, maxLogCount]);

  // 启动/停止轮询
  useEffect(() => {
    setIsPolling(true);
    pollingTimerRef.current = setInterval(pollNewLogs, 5000);

    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      setIsPolling(false);
    };
  }, [pollNewLogs]);

  // 初始加载日志（组件挂载时）
  useEffect(() => {
    const load = async () => {
      const entries = await fetchLogs(selectedLevel, 0, maxLogCount);
      setLogEntries(entries);
      if (entries.length > 0) {
        setLastLineNum(entries[entries.length - 1].lineNum);
        setOffset(entries.length);
      } else {
        setLastLineNum(0);
        setOffset(0);
      }
    };
    load();
    // 初始加载后滚动到底部
    setTimeout(() => {
      const el = tableContainerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
      setIsAtBottom(true);
    }, 100);
  }, []); // 只在组件挂载时执行一次

  // 过滤日志 (Moved up to fix initialization error)
  const filteredLogs = logEntries.filter((entry) => {
    if (selectedModule && entry.subsystem !== selectedModule) return false;
    if (keyword && !entry.message.toLowerCase().includes(keyword.toLowerCase())) return false;
    return true;
  });

  // 监听日志列表区域滚动，判断是否在底部（仅在该固定高度容器内滚轮）
  useLayoutEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return undefined;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      setIsAtBottom(atBottom);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // 当日志更新时，如果用户在底部，则自动滚动到底部
  useEffect(() => {
    const el = tableContainerRef.current;
    if (isAtBottom && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filteredLogs, isAtBottom]);

  // 切换日志等级时重新加载
  const handleLevelChange = async (newLevel) => {
    setSelectedLevel(newLevel);
    setOffset(0);
    setLastLineNum(0);
    await loadInitialLogs(newLevel);
  };

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
          <h2>日志查看</h2>
          <div className="settings-logging-search-controls">
            <span className={`polling-indicator ${isPolling ? "active" : ""}`}>
              {isPolling ? "● 实时更新中" : "○ 已暂停"}
            </span>
          </div>
        </div>
        <div className="settings-logging-search-body">
          <div className="settings-logging-search-filters">
            <div className="settings-form-group">
              <label className="settings-form-label">关键词</label>
              <input
                type="text"
                className="settings-form-input"
                placeholder="输入关键词搜索日志"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div className="settings-form-group">
              <label className="settings-form-label">日志等级</label>
              <select
                className="settings-form-input settings-form-select"
                value={selectedLevel}
                onChange={(e) => handleLevelChange(e.target.value)}
              >
                {LOG_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-form-group">
              <label className="settings-form-label">模块</label>
              <select
                className="settings-form-input settings-form-select"
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
              >
                <option value="">全部</option>
                <option value="auth">auth</option>
                <option value="agent">agent</option>
                <option value="qq">qq</option>
                <option value="watch-dog">watch-dog</option>
                <option value="memory">memory</option>
                <option value="tool">tool</option>
                <option value="attempt">attempt</option>
                <option value="model-config">model-config</option>
                <option value="compact-tool">compact-tool</option>
              </select>
            </div>
            <div className="settings-form-group">
              <label className="settings-form-label">最大显示条数</label>
              <input
                type="number"
                className="settings-form-input"
                value={maxLogCount}
                onChange={(e) => handleMaxLogCountChange(e.target.value)}
                min="100"
                max="2000"
                step="100"
              />
            </div>
          </div>
          <div className="settings-logging-search-results">
            <div
              ref={tableContainerRef}
              className="settings-logging-search-results-container"
            >
              {filteredLogs.length === 0 ? (
                <div className="settings-logging-search-empty">
                  <p>暂无日志数据</p>
                </div>
              ) : (
                <table className="settings-logging-table">
                  <thead>
                    <tr>
                      <th className="col-line-num">#</th>
                      <th className="col-level">等级</th>
                      <th className="col-subsystem">模块</th>
                      <th className="col-message">消息内容</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map((entry, index) => (
                      <tr key={entry.lineNum}>
                        <td className="col-line-num">{entry.lineNum}</td>
                        <td className="col-level">
                          <span
                            className="log-level-badge"
                            style={{
                              backgroundColor: LEVEL_COLORS[entry.level] || "#6b7280",
                            }}
                          >
                            {entry.level.toUpperCase()}
                          </span>
                        </td>
                        <td className="col-subsystem">
                          {entry.subsystem ? (
                            <span className="module-text" title={entry.subsystem}>
                              {entry.subsystem}
                            </span>
                          ) : (
                            <span className="module-text">-</span>
                          )}
                        </td>
                        <td className="col-message">
                          <span className="message-text">{entry.message}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

