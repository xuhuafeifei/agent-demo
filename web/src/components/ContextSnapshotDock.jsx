import { useState, useRef, useMemo, useEffect } from "react";
import { Layers2, X } from "lucide-react";
import { copyText } from "../utils/markdown";

function buildLineDiff(prevText, nextText) {
  const a = String(prevText || "").split("\n");
  const b = String(nextText || "").split("\n");
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const out = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ type: "same", line: a[i - 1] });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.push({ type: "del", line: a[i - 1] });
      i -= 1;
    } else {
      out.push({ type: "add", line: b[j - 1] });
      j -= 1;
    }
  }
  while (i > 0) {
    out.push({ type: "del", line: a[i - 1] });
    i -= 1;
  }
  while (j > 0) {
    out.push({ type: "add", line: b[j - 1] });
    j -= 1;
  }
  return out.reverse();
}

/**
 * 聊天区悬浮快照入口
 */
export default function ContextSnapshotDock({ contextEvents }) {
  const [contextOpen, setContextOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const dockRef = useRef(null);

  const snapshotEvents = useMemo(
    () =>
      [...(contextEvents || [])]
        .filter((event) => event.kind === "snapshot")
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 2),
    [contextEvents],
  );

  const latest = snapshotEvents[0] || null;
  const previous = snapshotEvents[1] || null;

  const diffLines = useMemo(
    () =>
      latest && previous
        ? buildLineDiff(previous.contextText, latest.contextText)
        : [],
    [latest, previous],
  );

  useEffect(() => {
    if (!contextOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setContextOpen(false);
        setExpandedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextOpen]);

  useEffect(() => {
    if (!contextOpen) return;
    const onPointerDown = (e) => {
      const el = dockRef.current;
      if (el && !el.contains(e.target)) {
        setContextOpen(false);
        setExpandedId(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [contextOpen]);

  if (!snapshotEvents.length) return null;

  return (
    <div
      ref={dockRef}
      className={`context-snapshot-dock ${contextOpen ? "context-snapshot-dock--open" : ""}`}
    >
      {contextOpen ? (
        <div className="context-panel context-panel--fab">
          <div className="context-panel-head">
            <span className="context-panel-title">上下文快照</span>
            <div className="context-panel-head-actions">
              <button
                type="button"
                className="context-chip-btn"
                onClick={() => setExpandedId(null)}
              >
                收起条目
              </button>
            </div>
          </div>
          <div className="context-panel-body">
            {snapshotEvents.map((event, index) => (
              <div key={event.id} className="context-item">
                <div className="context-meta">
                  <strong>
                    {index === 0 ? "最新快照" : "上一轮快照"}
                  </strong>
                  <span className="context-reason">{event.reason || "-"}</span>
                  <button
                    type="button"
                    className="context-chip-btn"
                    onClick={async () => {
                      await copyText(event.contextText || "");
                    }}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    className="context-chip-btn"
                    onClick={() =>
                      setExpandedId((prev) =>
                        prev === event.id ? null : event.id,
                      )
                    }
                  >
                    {expandedId === event.id ? "收起" : "展开"}
                  </button>
                </div>
                {expandedId === event.id ? (
                  <pre className="context-body-pre">{event.contextText || "-"}</pre>
                ) : null}
              </div>
            ))}
            {latest && previous ? (
              <div className="context-item">
                <div className="context-meta">
                  <strong>第二轮对比（vs 上一轮）</strong>
                  <button
                    type="button"
                    className="context-chip-btn"
                    onClick={async () => {
                      const text = diffLines
                        .map(
                          (item) =>
                            `${item.type === "add" ? "+" : item.type === "del" ? "-" : " "}${item.line}`,
                        )
                        .join("\n");
                      await copyText(text);
                    }}
                  >
                    复制对比
                  </button>
                </div>
                <div className="context-diff">
                  {diffLines.map((item, idx) => (
                    <div
                      key={`${item.type}_${idx}`}
                      className={`diff-line ${item.type === "add" ? "add" : item.type === "del" ? "del" : "same"}`}
                    >
                      {item.type === "add"
                        ? "+"
                        : item.type === "del"
                          ? "-"
                          : " "}
                      {item.line}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className={`context-fab ${contextOpen ? "context-fab--active" : ""}`}
        aria-expanded={contextOpen}
        aria-label={
          contextOpen
            ? "关闭上下文快照"
            : `打开上下文快照（${snapshotEvents.length}）`
        }
        onClick={() => {
          if (contextOpen) {
            setContextOpen(false);
            setExpandedId(null);
          } else {
            setContextOpen(true);
            if (latest) setExpandedId(latest.id);
          }
        }}
      >
        {contextOpen ? (
          <X size={22} strokeWidth={2} />
        ) : (
          <>
            <Layers2 size={22} strokeWidth={2} />
            <span className="context-fab-badge">{snapshotEvents.length}</span>
          </>
        )}
      </button>
    </div>
  );
}

export { buildLineDiff };
