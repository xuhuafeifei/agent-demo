// @ts-nocheck - Large component, will be gradually typed in Phase 4
import { ArrowDownToLine, HelpCircle } from "lucide-react";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
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

const LS_MAX_COUNT = "logViewerMaxCount";
const LS_FOLLOW_TAIL = "logViewerFollowTail";

function readStoredMaxCount() {
  try {
    const saved = localStorage.getItem(LS_MAX_COUNT);
    if (saved) {
      const n = parseInt(saved, 10);
      if (!Number.isNaN(n)) {
        return Math.max(100, Math.min(2000, n));
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_MAX_LOG_COUNT;
}

function readStoredFollowTail() {
  try {
    const s = localStorage.getItem(LS_FOLLOW_TAIL);
    if (s === null) return true;
    return s === "1" || s === "true";
  } catch {
    return true;
  }
}

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
  /** 输入框内容（未点搜索前不参与过滤） */
  const [keywordDraft, setKeywordDraft] = useState("");
  /** 已生效的关键词：点「搜索」或回车后写入 */
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [logEntries, setLogEntries] = useState([]);
  const [lastLineNum, setLastLineNum] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const [maxLogCount, setMaxLogCount] = useState(readStoredMaxCount);
  const [followTail, setFollowTail] = useState(readStoredFollowTail);
  const tableContainerRef = useRef(null); // 日志列表固定高度区域的滚动容器
  const pollingTimerRef = useRef(null);
  /** 供 5s 定时器读取最新 level / 锚点行号 / 条数上限 */
  const pollStateRef = useRef({
    selectedLevel,
    lastLineNum,
    maxLogCount,
  });
  pollStateRef.current = { selectedLevel, lastLineNum, maxLogCount };

  // 保存最大日志条数配置（持久化，与后端 level 过滤一致：仅保留当前展示等级及以上）
  const handleMaxLogCountChange = (value) => {
    const count = Math.max(100, Math.min(2000, parseInt(value, 10) || DEFAULT_MAX_LOG_COUNT));
    setMaxLogCount(count);
    try {
      localStorage.setItem(LS_MAX_COUNT, count.toString());
    } catch {
      /* ignore */
    }
  };

  const setFollowTailPersist = useCallback((next) => {
    setFollowTail(next);
    try {
      localStorage.setItem(LS_FOLLOW_TAIL, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  // 只调一个接口：GET /api/config/logging/tail（全量 / 增量由 lastLineNum 与后端 replaced 决定）
  const syncLogs = useCallback(async (forceFull) => {
    try {
      const { selectedLevel: level, lastLineNum: anchorState, maxLogCount: cap } =
        pollStateRef.current;
      const anchor = forceFull ? 0 : anchorState;

      const params = new URLSearchParams({
        level,
        maxCount: String(cap),
      });
      if (anchor > 0) {
        params.set("lastLineNum", String(anchor));
      }

      const response = await fetch(`/api/config/logging/tail?${params}`);
      const data = await response.json();
      if (!data.success) return;

      const entries = data.entries || [];
      const replaced = Boolean(data.replaced);

      if (entries.length === 0) {
        if (forceFull || anchor <= 0) {
          setLogEntries([]);
          setLastLineNum(0);
        }
        return;
      }

      if (forceFull || anchor <= 0 || replaced) {
        setLogEntries(entries);
        setLastLineNum(entries[entries.length - 1].lineNum);
        return;
      }

      let nextLast = 0;
      setLogEntries((prev) => {
        const merged = [...prev, ...entries].slice(-cap);
        nextLast = merged.length ? merged[merged.length - 1].lineNum : 0;
        return merged;
      });
      setLastLineNum(nextLast);
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    }
  }, []);

  useEffect(() => {
    setIsPolling(true);
    const id = setInterval(() => {
      void syncLogs(false);
    }, 5000);
    pollingTimerRef.current = id;
    return () => {
      clearInterval(id);
      pollingTimerRef.current = null;
      setIsPolling(false);
    };
  }, [syncLogs]);

  // 切换等级或最大条数：整表重拉（lastLineNum 由 ref 在下一帧前可能仍旧，用 forceFull 保证走最新快照）
  useEffect(() => {
    void syncLogs(true);
  }, [selectedLevel, maxLogCount, syncLogs]);

  const filteredLogs = useMemo(() => {
    const q = appliedKeyword.trim().toLowerCase();
    return logEntries.filter((entry) => {
      if (selectedModule && entry.subsystem !== selectedModule) return false;
      if (q && !entry.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logEntries, selectedModule, appliedKeyword]);

  const applyKeywordSearch = useCallback(() => {
    setAppliedKeyword(keywordDraft.trim());
  }, [keywordDraft]);

  // 跟随置底：DOM 提交后立刻滚到底（比 rAF 更稳，新数据渲染完再滚）
  useLayoutEffect(() => {
    if (!followTail) return;
    const el = tableContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [followTail, logEntries]);

  // 滚轮在内层日志框上时：设置页外层若未到底则先滚外层，再滚内层（需 passive:false 才能 preventDefault）
  useEffect(() => {
    const inner = tableContainerRef.current;
    if (!inner) return;

    const toPixelsY = (e) => {
      let y = e.deltaY;
      if (e.deltaMode === 1) y *= 16;
      else if (e.deltaMode === 2) y *= inner.clientHeight || 1;
      return y;
    };

    const onWheel = (e) => {
      const outer = inner.closest(".settings-page");
      if (!outer) return;

      const dy = toPixelsY(e);
      if (dy === 0) return;

      const eps = 1;
      const outerMax = Math.max(0, outer.scrollHeight - outer.clientHeight);
      const roomOuterDown = outerMax - outer.scrollTop;
      const roomOuterUp = outer.scrollTop;
      const roomInnerUp = inner.scrollTop;

      if (dy > 0) {
        if (roomOuterDown > eps) {
          e.preventDefault();
          outer.scrollTop = Math.min(outerMax, outer.scrollTop + dy);
        }
        return;
      }

      if (roomInnerUp > eps) return;
      if (roomOuterUp > eps) {
        e.preventDefault();
        outer.scrollTop = Math.max(0, outer.scrollTop + dy);
      }
    };

    inner.addEventListener("wheel", onWheel, { passive: false });
    return () => inner.removeEventListener("wheel", onWheel);
  }, []);

  const handleLevelChange = (newLevel) => {
    setSelectedLevel(newLevel);
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
            <div className="settings-form-group settings-form-group--keyword-search">
              <label className="settings-form-label">关键词</label>
              <div className="settings-logging-keyword-row">
                <input
                  type="text"
                  className="settings-form-input"
                  placeholder="输入后点搜索或回车"
                  value={keywordDraft}
                  onChange={(e) => setKeywordDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setAppliedKeyword(e.currentTarget.value.trim());
                    }
                  }}
                />
                <button
                  type="button"
                  className="settings-logging-search-btn"
                  onClick={applyKeywordSearch}
                >
                  搜索
                </button>
              </div>
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
              <label
                className="settings-form-label"
                title="保存在本机浏览器，刷新后仍有效；与当前「日志等级」筛选一致，仅保留该等级及更高级别"
              >
                最大显示条数
              </label>
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
          <div className="settings-logging-search-results settings-logging-search-results--fab">
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
                    {filteredLogs.map((entry) => (
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
            <button
              type="button"
              className={`settings-logging-follow-fab ${followTail ? "is-active" : ""}`}
              onClick={() => {
                const next = !followTail;
                setFollowTailPersist(next);
                if (next) {
                  requestAnimationFrame(() => {
                    const el = tableContainerRef.current;
                    if (el) el.scrollTop = el.scrollHeight;
                  });
                }
              }}
              aria-pressed={followTail}
              title={
                followTail
                  ? "已开启：追加日志时自动滚到底"
                  : "已关闭：追加日志时不自动滚动，可自由查看历史位置"
              }
            >
              <ArrowDownToLine size={18} strokeWidth={2.25} aria-hidden />
              <span>{followTail ? "跟随置底" : "跟随关"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

