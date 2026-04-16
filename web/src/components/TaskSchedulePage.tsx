import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfigProvider, Table } from "antd";
import type { TableColumnsType } from "antd";
import { request } from "../api/client";

/** 与后端 `PROTECTED_TASK_NAMES` 一致：禁止删除、禁止改表达式 */
const SYSTEM_TASK_NAMES = new Set(["cleanup_logs", "one_minute_heartbeat"]);

type TaskScheduleRow = {
  id: number;
  task_name: string;
  task_type: string;
  task_type_label?: string;
  payload_text: string | null;
  schedule_kind: "cron" | "once";
  schedule_kind_label?: string;
  schedule_expr: string;
  timezone: string;
  status: string;
  status_label?: string;
  attempts: number;
  last_error: string | null;
  create_time: string;
  update_time: string;
  next_run_time: string;
  started_at: string | null;
  finished_at: string | null;
  tenant_id: string;
};

type TaskDetailRow = {
  id: number;
  task_id: number;
  start_time: string;
  end_time: string;
  create_time: string;
  update_time: string;
  status: string;
  error_message: string | null;
  executor: string | null;
};

type ConfirmKind = null | "saveExpr" | "trigger" | "delete" | "execSql";

type ConfirmState = {
  kind: ConfirmKind;
  taskName?: string;
  taskId?: number;
  scheduleExprDraft?: string;
  sqlDraft?: string;
  message?: string;
};

const API_BASE = "/api/task-schedules";
type ResizableColKey =
  | "id"
  | "task_name"
  | "tenant_id"
  | "task_type"
  | "schedule"
  | "status"
  | "next_run_time"
  | "payload"
  | "actions";

type ResizeState = Record<ResizableColKey, number>;

type ResizeCellProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  resizeKey?: ResizableColKey;
  onResizeStart?: (
    key: ResizableColKey,
    e: React.MouseEvent<HTMLSpanElement>,
  ) => void;
};

function ResizableHeaderCell({
  resizeKey,
  onResizeStart,
  children,
  ...rest
}: ResizeCellProps) {
  return (
    <th {...rest}>
      {children}
      {resizeKey && onResizeStart ? (
        <span
          className="task-sched-resizer"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onResizeStart(resizeKey, e);
          }}
        />
      ) : null}
    </th>
  );
}

function formatDisplayTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const normalized = iso.replace("T", " ").replace(/\.\d{3}/, "");
  if (normalized.length > 19) return normalized.slice(0, 19);
  return normalized;
}

const TASK_TYPE_LABELS: Record<string, string> = {
  execute_script: "脚本执行",
  execute_reminder: "提醒任务",
  execute_agent: "Agent任务",
  cleanup_logs: "日志清理",
  one_minute_heartbeat: "一分钟心跳",
};

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  done: "已完成",
  failed: "失败",
  timeout: "超时",
};

const DETAIL_STATUS_LABELS: Record<string, string> = {
  success: "成功",
  failed: "失败",
  timeout: "超时",
  skipped: "跳过",
};

function getTaskTypeLabel(type: string) {
  return TASK_TYPE_LABELS[type] || type;
}
function getTaskStatusLabel(status: string) {
  return TASK_STATUS_LABELS[status] || status;
}
function getDetailStatusLabel(status: string) {
  return DETAIL_STATUS_LABELS[status] || status;
}
function getScheduleKindLabel(kind: string) {
  return kind === "once" ? "运行一次" : "cron调度";
}

function JsonHighlighter({ text }: { text: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return <pre className="task-sched-json-pre">{text}</pre>;
  }
  return <pre className="task-sched-json-pre">{renderValue(parsed)}</pre>;
}

function renderValue(v: unknown, indent = 0): React.ReactNode {
  const pad = "  ".repeat(indent);
  if (v === null) return <span className="task-sched-json-null">null</span>;
  if (typeof v === "boolean")
    return <span className="task-sched-json-boolean">{String(v)}</span>;
  if (typeof v === "number")
    return <span className="task-sched-json-number">{String(v)}</span>;
  if (typeof v === "string")
    return <span className="task-sched-json-string">{JSON.stringify(v)}</span>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span>[]</span>;
    return (
      <>
        {"[\n"}
        {v.map((item, i) => (
          <span key={i}>
            {pad}
            {"  "}
            {renderValue(item, indent + 1)}
            {i < v.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {pad}
        {"]"}
      </>
    );
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return <span>{"{}"}</span>;
  return (
    <>
      {"{\n"}
      {keys.map((k, i) => (
        <span key={k}>
          {pad}
          {"  "}
          <span className="task-sched-json-key">{JSON.stringify(k)}</span>
          {": "}
          {renderValue(obj[k], indent + 1)}
          {i < keys.length - 1 ? "," : ""}
          {"\n"}
        </span>
      ))}
      {pad}
      {"}"}
    </>
  );
}

function todayShanghaiDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/**
 * 调度任务可视化：主表操作 + 明细只读 + SQL 辅助（仅主表 UPDATE）
 */
export default function TaskSchedulePage() {
  const [tasks, setTasks] = useState<TaskScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailDay, setDetailDay] = useState(() => todayShanghaiDateString());
  const [filterTenantId, setFilterTenantId] = useState("");
  const [filterTaskType, setFilterTaskType] = useState("");
  const [detailsByTask, setDetailsByTask] = useState<
    Record<
      number,
      {
        loading: boolean;
        error: string;
        rows: TaskDetailRow[];
        range?: { fromIso: string; toIso: string };
      }
    >
  >({});
  const [exprDraftById, setExprDraftById] = useState<Record<number, string>>(
    {},
  );
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>({ kind: null });
  const [toast, setToast] = useState("");
  const [payloadModal, setPayloadModal] = useState<{
    taskName: string;
    content: string;
  } | null>(null);
  const [colWidths, setColWidths] = useState<ResizeState>({
    id: 72,
    task_name: 160,
    tenant_id: 90,
    task_type: 100,
    schedule: 260,
    status: 84,
    next_run_time: 150,
    payload: 72,
    actions: 150,
  });
  const resizeRef = useRef<{
    key: ResizableColKey;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleResizeStart = useCallback(
    (key: ResizableColKey, e: React.MouseEvent<HTMLSpanElement>) => {
      resizeRef.current = {
        key,
        startX: e.clientX,
        startWidth: colWidths[key],
      };
    },
    [colWidths],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { key, startX, startWidth } = resizeRef.current;
      const delta = e.clientX - startX;
      const next = Math.max(60, startWidth + delta);
      setColWidths((prev) => ({ ...prev, [key]: next }));
    };
    const onMouseUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setListError("");
    const res = await request<{ tasks: TaskScheduleRow[] }>(API_BASE);
    if (!res.success) {
      setListError((res as any).error || "加载失败");
      setTasks([]);
    } else {
      setTasks(res.tasks || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const syncExprDrafts = useCallback((list: TaskScheduleRow[]) => {
    setExprDraftById((prev) => {
      const next = { ...prev };
      for (const t of list) {
        if (next[t.id] === undefined) next[t.id] = t.schedule_expr;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    syncExprDrafts(tasks);
  }, [tasks, syncExprDrafts]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filterTenantId && t.tenant_id !== filterTenantId) return false;
      if (filterTaskType && t.task_type !== filterTaskType) return false;
      return true;
    });
  }, [tasks, filterTenantId, filterTaskType]);

  const fetchDetails = useCallback(
    async (taskId: number) => {
      const q = detailDay ? `?day=${encodeURIComponent(detailDay)}` : "";
      setDetailsByTask((d) => ({
        ...d,
        [taskId]: {
          ...(d[taskId] || { rows: [] }),
          loading: true,
          error: "",
          rows: d[taskId]?.rows || [],
        },
      }));
      const res = await request<{
        details: TaskDetailRow[];
        range: { fromIso: string; toIso: string };
      }>(`${API_BASE}/${taskId}/details${q}`);
      if (!res.success) {
        setDetailsByTask((d) => ({
          ...d,
          [taskId]: {
            loading: false,
            error: (res as any).error || "加载明细失败",
            rows: [],
          },
        }));
        return;
      }
      setDetailsByTask((d) => ({
        ...d,
        [taskId]: {
          loading: false,
          error: "",
          rows: res.details || [],
          range: res.range,
        },
      }));
    },
    [detailDay],
  );

  useEffect(() => {
    if (expandedId != null) {
      void fetchDetails(expandedId);
    }
  }, [expandedId, fetchDetails]);

  const openSaveExprConfirm = (task: TaskScheduleRow) => {
    const draft = exprDraftById[task.id] ?? task.schedule_expr;
    setConfirm({
      kind: "saveExpr",
      taskId: task.id,
      taskName: task.task_name,
      scheduleExprDraft: draft,
      message:
        task.schedule_kind === "cron"
          ? `将更新 cron 表达式并重新计算下次执行时间。\n\n任务：${task.task_name}`
          : `将更新 once 的触发时间（schedule_expr 与 next_run_time 同步为该字符串）。\n\n任务：${task.task_name}`,
    });
  };

  const doSaveExpr = async () => {
    const id = confirm.taskId;
    const expr = confirm.scheduleExprDraft?.trim();
    if (id == null || !expr) return;
    setBusyId(id);
    const res = await request<{ task: TaskScheduleRow }>(
      `${API_BASE}/${id}/schedule-expr`,
      {
        method: "PATCH",
        body: JSON.stringify({ schedule_expr: expr }),
      },
    );
    setBusyId(null);
    setConfirm({ kind: null });
    if (!res.success) {
      setToast((res as any).error || "保存失败");
      return;
    }
    setToast("已保存");
    if (id != null) {
      setExprDraftById((prev) => ({ ...prev, [id]: expr }));
    }
    await loadTasks();
  };

  const openTriggerConfirm = (taskName: string) => {
    setConfirm({
      kind: "trigger",
      taskName,
      message: `立即执行任务「${taskName}」？\n\n说明：手动触发不会推进 cron 的 next_run_time。`,
    });
  };

  const doTrigger = async () => {
    const name = confirm.taskName;
    if (!name) return;
    const res = await request(`${API_BASE}/trigger`, {
      method: "POST",
      body: JSON.stringify({ task_name: name }),
    });
    setConfirm({ kind: null });
    if (!res.success) {
      setToast((res as any).error || "触发失败");
      return;
    }
    setToast("已触发");
    if (expandedId != null) void fetchDetails(expandedId);
    await loadTasks();
  };

  const openDeleteConfirm = (taskName: string) => {
    setConfirm({
      kind: "delete",
      taskName,
      message: `确定删除任务「${taskName}」？明细记录将一并删除，不可恢复。`,
    });
  };

  const doDelete = async () => {
    const name = confirm.taskName;
    if (!name) return;
    const res = await request(
      `${API_BASE}/by-name/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
      },
    );
    setConfirm({ kind: null });
    if (!res.success) {
      setToast((res as any).error || "删除失败");
      return;
    }
    setToast("已删除");
    setExpandedId(null);
    await loadTasks();
  };

  const copySql = async (path: string) => {
    const res = await request<{ sql: string }>(`${API_BASE}${path}`);
    if (!res.success) {
      setToast((res as any).error || "获取 SQL 失败");
      return;
    }
    try {
      await navigator.clipboard.writeText(res.sql);
      setToast("已复制到剪贴板");
    } catch {
      setToast("复制失败，请手动选择 SQL");
    }
  };

  const openExecSqlModal = (taskId: number) => {
    setConfirm({
      kind: "execSql",
      taskId,
      sqlDraft: `-- 示例：UPDATE task_schedule SET schedule_expr = '0 */5 * * * *' WHERE id = ${taskId}\n`,
      message:
        "仅允许单条 UPDATE 主表语句，且必须包含 WHERE id = <数字>。禁止修改明细表。",
    });
  };

  const doExecSql = async () => {
    const sql = confirm.sqlDraft?.trim();
    if (!sql) return;
    const res = await request(`${API_BASE}/exec-sql`, {
      method: "POST",
      body: JSON.stringify({ sql }),
    });
    setConfirm({ kind: null });
    if (!res.success) {
      setToast((res as any).error || "执行失败");
      return;
    }
    setToast("SQL 已执行");
    await loadTasks();
    if (expandedId != null) void fetchDetails(expandedId);
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const columns: TableColumnsType<TaskScheduleRow> = [
    {
      title: "任务ID",
      dataIndex: "id",
      key: "id",
      width: colWidths.id,
      onHeaderCell: () =>
        ({ resizeKey: "id", onResizeStart: handleResizeStart }) as any,
    },
    {
      title: "名称",
      dataIndex: "task_name",
      key: "task_name",
      width: colWidths.task_name,
      onHeaderCell: () =>
        ({ resizeKey: "task_name", onResizeStart: handleResizeStart }) as any,
      render: (name: string) => (
        <div className="task-sched-ellipsis" title={name}>
          {name}
        </div>
      ),
    },
    {
      title: "租户ID",
      dataIndex: "tenant_id",
      key: "tenant_id",
      width: colWidths.tenant_id,
      onHeaderCell: () =>
        ({ resizeKey: "tenant_id", onResizeStart: handleResizeStart }) as any,
    },
    {
      title: "类型",
      key: "task_type",
      width: colWidths.task_type,
      onHeaderCell: () =>
        ({ resizeKey: "task_type", onResizeStart: handleResizeStart }) as any,
      render: (_, row) =>
        row.task_type_label || getTaskTypeLabel(row.task_type),
    },
    {
      title: "调度",
      key: "schedule",
      width: colWidths.schedule,
      onHeaderCell: () =>
        ({ resizeKey: "schedule", onResizeStart: handleResizeStart }) as any,
      render: (_, row) => (
        <div className="task-sched-schedule">
          <div className="task-sched-schedule-kind">
            {row.schedule_kind_label || getScheduleKindLabel(row.schedule_kind)}
          </div>
          <div className="task-sched-schedule-detail" title={row.schedule_expr}>
            {row.schedule_kind === "once"
              ? `运行时间：${formatDisplayTime(row.schedule_expr)}`
              : `cron表达式：${row.schedule_expr}`}
          </div>
        </div>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: colWidths.status,
      onHeaderCell: () =>
        ({ resizeKey: "status", onResizeStart: handleResizeStart }) as any,
      render: (_, row) => row.status_label || getTaskStatusLabel(row.status),
    },
    {
      title: "下次执行",
      dataIndex: "next_run_time",
      key: "next_run_time",
      width: colWidths.next_run_time,
      onHeaderCell: () =>
        ({
          resizeKey: "next_run_time",
          onResizeStart: handleResizeStart,
        }) as any,
      render: (value: string) => formatDisplayTime(value),
    },
    {
      title: "Payload",
      key: "payload",
      width: colWidths.payload,
      onHeaderCell: () =>
        ({ resizeKey: "payload", onResizeStart: handleResizeStart }) as any,
      render: (_, row) => (
        <button
          type="button"
          className="task-sched-btn task-sched-icon-btn"
          title="查看 Payload"
          onClick={(e) => {
            e.stopPropagation();
            setPayloadModal({
              taskName: row.task_name,
              content: row.payload_text || "",
            });
          }}
        >
          🔍
        </button>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: colWidths.actions,
      fixed: "right",
      className: "task-sched-col-actions",
      onHeaderCell: () =>
        ({ resizeKey: "actions", onResizeStart: handleResizeStart }) as any,
      onCell: () => ({ style: { minWidth: colWidths.actions } }),
      render: (_, row) => {
        const isSystem = SYSTEM_TASK_NAMES.has(row.task_name);
        return (
          <div
            className="task-sched-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="task-sched-btn task-sched-icon-btn primary"
              title="立即执行"
              aria-label="立即执行"
              data-tooltip="立即执行"
              onClick={() => openTriggerConfirm(row.task_name)}
            >
              ▶
            </button>
            {!isSystem ? (
              <button
                type="button"
                className="task-sched-btn danger"
                onClick={() => openDeleteConfirm(row.task_name)}
              >
                删除
              </button>
            ) : null}
            <button
              type="button"
              className="task-sched-btn task-sched-icon-btn"
              title="复制 INSERT SQL"
              aria-label="复制 INSERT SQL"
              data-tooltip="复制 INSERT SQL"
              onClick={() => void copySql(`/${row.id}/sql-insert`)}
            >
              ＋
            </button>
            <button
              type="button"
              className="task-sched-btn task-sched-icon-btn"
              title="复制 UPDATE SQL"
              aria-label="复制 UPDATE SQL"
              data-tooltip="复制 UPDATE SQL"
              onClick={() => void copySql(`/${row.id}/sql-update`)}
            >
              ⎘
            </button>
            <button
              type="button"
              className="task-sched-btn task-sched-icon-btn"
              title="执行 UPDATE SQL"
              aria-label="执行 UPDATE SQL"
              data-tooltip="执行 UPDATE SQL"
              onClick={() => openExecSqlModal(row.id)}
            >
              ⚡
            </button>
          </div>
        );
      },
    },
  ];

  const totalTableWidth =
    colWidths.id +
    colWidths.task_name +
    colWidths.tenant_id +
    colWidths.task_type +
    colWidths.schedule +
    colWidths.status +
    colWidths.next_run_time +
    colWidths.payload +
    colWidths.actions +
    0; // 展开列和边距补偿

  const renderExpandedRow = (t: TaskScheduleRow) => {
    const isSystem = SYSTEM_TASK_NAMES.has(t.task_name);
    const detail = detailsByTask[t.id];
    return (
      <div>
        <div className="task-sched-content-box">
          {t.payload_text ? (
            <div className="task-sched-content-line" title={t.payload_text}>
              <strong>任务内容：</strong>
              <span className="task-sched-ellipsis-inline">
                {t.payload_text}
              </span>
            </div>
          ) : null}
          {t.last_error ? (
            <div
              className="task-sched-content-line task-sched-content-error"
              title={t.last_error}
            >
              <strong>最近错误：</strong>
              <span className="task-sched-ellipsis-inline">{t.last_error}</span>
            </div>
          ) : null}
        </div>
        <strong>执行明细</strong>
        {detail?.range ? (
          <span className="task-sched-hint" style={{ marginLeft: 8 }}>
            窗口 {formatDisplayTime(detail.range.fromIso)} —{" "}
            {formatDisplayTime(detail.range.toIso)}，最多 3 条
          </span>
        ) : null}
        {detail?.loading ? <p>加载明细…</p> : null}
        {detail?.error ? (
          <div className="task-sched-err">{detail.error}</div>
        ) : null}
        {!detail?.loading && detail?.rows?.length === 0 ? (
          <p className="task-sched-hint">当日无明细</p>
        ) : null}
        {detail?.rows && detail.rows.length > 0 ? (
          <table className="task-sched-detail-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>创建时间</th>
                <th>开始时间</th>
                <th>结束时间</th>
                <th>执行状态</th>
                <th>执行者</th>
                <th>错误信息</th>
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{formatDisplayTime(r.create_time)}</td>
                  <td>{formatDisplayTime(r.start_time)}</td>
                  <td>{formatDisplayTime(r.end_time)}</td>
                  <td>{getDetailStatusLabel(r.status)}</td>
                  <td>{r.executor ?? ""}</td>
                  <td>{r.error_message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {!isSystem ? (
          <div className="task-sched-expr-edit">
            <span>
              {t.schedule_kind === "cron"
                ? "修改 Cron 表达式（5 或 6 段）"
                : "修改单次触发时间"}
            </span>
            <input
              value={exprDraftById[t.id] ?? t.schedule_expr}
              onChange={(e) =>
                setExprDraftById((prev) => ({
                  ...prev,
                  [t.id]: e.target.value,
                }))
              }
            />
            <button
              type="button"
              className="task-sched-btn primary"
              disabled={busyId === t.id}
              onClick={() => openSaveExprConfirm(t)}
            >
              保存表达式…
            </button>
          </div>
        ) : (
          <p className="task-sched-hint">系统任务不可在此修改表达式</p>
        )}
      </div>
    );
  };

  return (
    <div className="task-sched-page">
      <h1>调度任务</h1>
      <p className="task-sched-hint">
        主表来自调度中心。展开行可查看当天执行明细（按创建时间倒序，最多 3
        条）。日期默认上海当天，可切换查看其它日。
        明细不可编辑。系统任务（日志清理、一分钟心跳）不可删除、不可改表达式。
      </p>

      <div className="task-sched-toolbar">
        <label>
          明细日期（上海）
          <input
            type="date"
            value={detailDay}
            onChange={(e) => setDetailDay(e.target.value)}
          />
        </label>
        <label>
          租户ID
          <select
            value={filterTenantId}
            onChange={(e) => setFilterTenantId(e.target.value)}
          >
            <option value="">全部</option>
            {[...new Set(tasks.map((t) => t.tenant_id))].sort().map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          类型
          <select
            value={filterTaskType}
            onChange={(e) => setFilterTaskType(e.target.value)}
          >
            <option value="">全部</option>
            {[...new Set(tasks.map((t) => t.task_type))].sort().map((type) => (
              <option key={type} value={type}>
                {TASK_TYPE_LABELS[type] || type}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="task-sched-btn"
          onClick={() => void loadTasks()}
        >
          刷新列表
        </button>
      </div>

      {toast ? (
        <div
          className="task-sched-hint"
          style={{ color: "var(--primary-green-dark)" }}
        >
          {toast}
        </div>
      ) : null}
      {listError ? <div className="task-sched-err">{listError}</div> : null}

      {loading ? (
        <p className="task-sched-hint">加载中…</p>
      ) : (
        <div className="task-sched-table-wrap">
          <ConfigProvider
            theme={{
              token: {
                colorPrimary: "#7ac58b",
                borderRadius: 10,
              },
            }}
          >
            <Table<TaskScheduleRow>
              className="task-sched-antd-table"
              rowKey="id"
              columns={columns}
              dataSource={filteredTasks}
              pagination={false}
              bordered
              size="small"
              // scroll={{ x: totalTableWidth }}
              rowClassName={(row) =>
                expandedId === row.id
                  ? "task-sched-row-main expanded"
                  : "task-sched-row-main"
              }
              expandable={{
                expandedRowRender: renderExpandedRow,
                expandedRowKeys: expandedId != null ? [expandedId] : [],
                onExpand: (expanded, row) =>
                  setExpandedId(expanded ? row.id : null),
                expandRowByClick: true,
              }}
              components={{
                header: {
                  cell: ResizableHeaderCell,
                },
              }}
            />
          </ConfigProvider>
        </div>
      )}

      {payloadModal ? (
        <div
          className="task-sched-modal-mask"
          role="dialog"
          aria-modal="true"
          onClick={() => setPayloadModal(null)}
        >
          <div
            className="task-sched-modal task-sched-modal--wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Payload — {payloadModal.taskName}</h3>
            <div className="task-sched-json-wrap">
              <JsonHighlighter text={payloadModal.content} />
            </div>
            <div className="task-sched-modal-actions">
              <button
                type="button"
                className="task-sched-btn"
                onClick={() => setPayloadModal(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirm.kind ? (
        <div className="task-sched-modal-mask" role="dialog" aria-modal="true">
          <div className="task-sched-modal">
            <h3>
              {confirm.kind === "saveExpr"
                ? "确认保存调度表达式"
                : confirm.kind === "trigger"
                  ? "确认立即执行"
                  : confirm.kind === "delete"
                    ? "确认删除任务"
                    : "执行 UPDATE SQL"}
            </h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{confirm.message}</p>
            {confirm.kind === "saveExpr" ? (
              <textarea
                value={confirm.scheduleExprDraft || ""}
                onChange={(e) =>
                  setConfirm((c) =>
                    c.kind === "saveExpr"
                      ? { ...c, scheduleExprDraft: e.target.value }
                      : c,
                  )
                }
              />
            ) : null}
            {confirm.kind === "execSql" ? (
              <textarea
                placeholder="UPDATE task_schedule SET ... WHERE id = 1"
                value={confirm.sqlDraft || ""}
                onChange={(e) =>
                  setConfirm((c) => ({ ...c, sqlDraft: e.target.value }))
                }
              />
            ) : null}
            <div className="task-sched-modal-actions">
              <button
                type="button"
                className="task-sched-btn"
                onClick={() => setConfirm({ kind: null })}
              >
                取消
              </button>
              {confirm.kind === "saveExpr" ? (
                <button
                  type="button"
                  className="task-sched-btn primary"
                  disabled={busyId != null}
                  onClick={() => void doSaveExpr()}
                >
                  确认保存
                </button>
              ) : null}
              {confirm.kind === "trigger" ? (
                <button
                  type="button"
                  className="task-sched-btn primary"
                  onClick={() => void doTrigger()}
                >
                  确认执行
                </button>
              ) : null}
              {confirm.kind === "delete" ? (
                <button
                  type="button"
                  className="task-sched-btn danger"
                  onClick={() => void doDelete()}
                >
                  确认删除
                </button>
              ) : null}
              {confirm.kind === "execSql" ? (
                <button
                  type="button"
                  className="task-sched-btn primary"
                  onClick={() => void doExecSql()}
                >
                  执行
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
