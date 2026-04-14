import { Fragment, useCallback, useEffect, useState } from 'react';
import { request } from '../api/client';

/** 与后端 `PROTECTED_TASK_NAMES` 一致：禁止删除、禁止改表达式 */
const SYSTEM_TASK_NAMES = new Set(['cleanup_logs', 'one_minute_heartbeat']);

type TaskScheduleRow = {
  id: number;
  task_name: string;
  task_type: string;
  payload_text: string | null;
  schedule_kind: 'cron' | 'once';
  schedule_expr: string;
  timezone: string;
  status: string;
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

type ConfirmKind =
  | null
  | 'saveExpr'
  | 'trigger'
  | 'delete'
  | 'execSql';

type ConfirmState = {
  kind: ConfirmKind;
  taskName?: string;
  taskId?: number;
  scheduleExprDraft?: string;
  sqlDraft?: string;
  message?: string;
};

const API_BASE = '/api/task-schedules';

function todayShanghaiDateString(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

/**
 * 调度任务可视化：主表操作 + 明细只读 + SQL 辅助（仅主表 UPDATE）
 */
export default function TaskSchedulePage() {
  const [tasks, setTasks] = useState<TaskScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailDay, setDetailDay] = useState(() => todayShanghaiDateString());
  const [detailsByTask, setDetailsByTask] = useState<
    Record<number, { loading: boolean; error: string; rows: TaskDetailRow[]; range?: { fromIso: string; toIso: string } }>
  >({});
  const [exprDraftById, setExprDraftById] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>({ kind: null });
  const [toast, setToast] = useState('');

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setListError('');
    const res = await request<{ tasks: TaskScheduleRow[] }>(API_BASE);
    if (!res.success) {
      setListError(res.error || '加载失败');
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

  const fetchDetails = useCallback(
    async (taskId: number) => {
      const q = detailDay ? `?day=${encodeURIComponent(detailDay)}` : '';
      setDetailsByTask((d) => ({
        ...d,
        [taskId]: { ...(d[taskId] || { rows: [] }), loading: true, error: '', rows: d[taskId]?.rows || [] },
      }));
      const res = await request<{
        details: TaskDetailRow[];
        range: { fromIso: string; toIso: string };
      }>(`${API_BASE}/${taskId}/details${q}`);
      if (!res.success) {
        setDetailsByTask((d) => ({
          ...d,
          [taskId]: { loading: false, error: res.error || '加载明细失败', rows: [] },
        }));
        return;
      }
      setDetailsByTask((d) => ({
        ...d,
        [taskId]: {
          loading: false,
          error: '',
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

  const toggleRow = (id: number) => {
    setExpandedId((cur) => (cur === id ? null : id));
  };

  const openSaveExprConfirm = (task: TaskScheduleRow) => {
    const draft = exprDraftById[task.id] ?? task.schedule_expr;
    setConfirm({
      kind: 'saveExpr',
      taskId: task.id,
      taskName: task.task_name,
      scheduleExprDraft: draft,
      message:
        task.schedule_kind === 'cron'
          ? `将更新 cron 表达式并重新计算下次执行时间。\n\n任务：${task.task_name}`
          : `将更新 once 的触发时间（schedule_expr 与 next_run_time 同步为该字符串）。\n\n任务：${task.task_name}`,
    });
  };

  const doSaveExpr = async () => {
    const id = confirm.taskId;
    const expr = confirm.scheduleExprDraft?.trim();
    if (id == null || !expr) return;
    setBusyId(id);
    const res = await request<{ task: TaskScheduleRow }>(`${API_BASE}/${id}/schedule-expr`, {
      method: 'PATCH',
      body: JSON.stringify({ schedule_expr: expr }),
    });
    setBusyId(null);
    setConfirm({ kind: null });
    if (!res.success) {
      setToast(res.error || '保存失败');
      return;
    }
    setToast('已保存');
    if (id != null) {
      setExprDraftById((prev) => ({ ...prev, [id]: expr }));
    }
    await loadTasks();
  };

  const openTriggerConfirm = (taskName: string) => {
    setConfirm({
      kind: 'trigger',
      taskName,
      message: `立即执行任务「${taskName}」？\n\n说明：手动触发不会推进 cron 的 next_run_time。`,
    });
  };

  const doTrigger = async () => {
    const name = confirm.taskName;
    if (!name) return;
    const res = await request(`${API_BASE}/trigger`, {
      method: 'POST',
      body: JSON.stringify({ task_name: name }),
    });
    setConfirm({ kind: null });
    if (!res.success) {
      setToast(res.error || '触发失败');
      return;
    }
    setToast('已触发');
    if (expandedId != null) void fetchDetails(expandedId);
    await loadTasks();
  };

  const openDeleteConfirm = (taskName: string) => {
    setConfirm({
      kind: 'delete',
      taskName,
      message: `确定删除任务「${taskName}」？明细记录将一并删除，不可恢复。`,
    });
  };

  const doDelete = async () => {
    const name = confirm.taskName;
    if (!name) return;
    const res = await request(`${API_BASE}/by-name/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    setConfirm({ kind: null });
    if (!res.success) {
      setToast(res.error || '删除失败');
      return;
    }
    setToast('已删除');
    setExpandedId(null);
    await loadTasks();
  };

  const copySql = async (path: string) => {
    const res = await request<{ sql: string }>(`${API_BASE}${path}`);
    if (!res.success) {
      setToast(res.error || '获取 SQL 失败');
      return;
    }
    try {
      await navigator.clipboard.writeText(res.sql);
      setToast('已复制到剪贴板');
    } catch {
      setToast('复制失败，请手动选择 SQL');
    }
  };

  const openExecSqlModal = (taskId: number) => {
    setConfirm({
      kind: 'execSql',
      taskId,
      sqlDraft: `-- 示例：UPDATE task_schedule SET schedule_expr = '0 */5 * * * *' WHERE id = ${taskId}\n`,
      message:
        '仅允许单条 UPDATE task_schedule，且必须包含 WHERE id = <数字>。禁止修改 task_schedule_detail。',
    });
  };

  const doExecSql = async () => {
    const sql = confirm.sqlDraft?.trim();
    if (!sql) return;
    const res = await request(`${API_BASE}/exec-sql`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
    setConfirm({ kind: null });
    if (!res.success) {
      setToast(res.error || '执行失败');
      return;
    }
    setToast('SQL 已执行');
    await loadTasks();
    if (expandedId != null) void fetchDetails(expandedId);
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div className="task-sched-page">
      <h1>调度任务</h1>
      <p className="task-sched-hint">
        主表来自 watch-dog（task_schedule）。展开行可查看当天明细（按 create_time 倒序，最多 3 条）。日期默认上海当天，可切换查看其它日。
        明细不可编辑。系统任务（cleanup_logs、one_minute_heartbeat）不可删除、不可改表达式。
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
        <button type="button" className="task-sched-btn" onClick={() => void loadTasks()}>
          刷新列表
        </button>
      </div>

      {toast ? <div className="task-sched-hint" style={{ color: 'var(--primary-green-dark)' }}>{toast}</div> : null}
      {listError ? <div className="task-sched-err">{listError}</div> : null}

      {loading ? (
        <p className="task-sched-hint">加载中…</p>
      ) : (
        <div className="task-sched-table-wrap">
          <table className="task-sched-table">
            <thead>
              <tr>
                <th />
                <th>名称</th>
                <th>类型</th>
                <th>调度</th>
                <th>状态</th>
                <th>下次执行</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const isOpen = expandedId === t.id;
                const isSystem = SYSTEM_TASK_NAMES.has(t.task_name);
                const detail = detailsByTask[t.id];
                return (
                  <Fragment key={t.id}>
                    <tr
                      className={`task-sched-row-main ${isOpen ? 'expanded' : ''}`}
                      onClick={() => toggleRow(t.id)}
                    >
                      <td>{isOpen ? '▼' : '▶'}</td>
                      <td>{t.task_name}</td>
                      <td>{t.task_type}</td>
                      <td>
                        {t.schedule_kind === 'cron' ? (
                          <span title={t.schedule_expr}>cron: {t.schedule_expr}</span>
                        ) : (
                          <span title={t.schedule_expr}>once: {t.schedule_expr}</span>
                        )}
                      </td>
                      <td>{t.status}</td>
                      <td>{t.next_run_time}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="task-sched-actions">
                          <button
                            type="button"
                            className="task-sched-btn primary"
                            onClick={() => openTriggerConfirm(t.task_name)}
                          >
                            立即执行
                          </button>
                          {!isSystem ? (
                            <button
                              type="button"
                              className="task-sched-btn danger"
                              onClick={() => openDeleteConfirm(t.task_name)}
                            >
                              删除
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="task-sched-btn"
                            onClick={() => void copySql(`/${t.id}/sql-insert`)}
                          >
                            复制 INSERT SQL
                          </button>
                          <button
                            type="button"
                            className="task-sched-btn"
                            onClick={() => void copySql(`/${t.id}/sql-update`)}
                          >
                            复制 UPDATE SQL
                          </button>
                          <button type="button" className="task-sched-btn" onClick={() => openExecSqlModal(t.id)}>
                            执行 UPDATE SQL…
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="task-sched-detail-row">
                        <td colSpan={7}>
                          <strong>执行明细</strong>
                          {detail?.range ? (
                            <span className="task-sched-hint" style={{ marginLeft: 8 }}>
                              窗口 {detail.range.fromIso} — {detail.range.toIso}，最多 3 条
                            </span>
                          ) : null}
                          {detail?.loading ? <p>加载明细…</p> : null}
                          {detail?.error ? <div className="task-sched-err">{detail.error}</div> : null}
                          {!detail?.loading && detail?.rows?.length === 0 ? (
                            <p className="task-sched-hint">当日无明细</p>
                          ) : null}
                          {detail?.rows && detail.rows.length > 0 ? (
                            <table className="task-sched-detail-table">
                              <thead>
                                <tr>
                                  <th>id</th>
                                  <th>create_time</th>
                                  <th>start</th>
                                  <th>end</th>
                                  <th>status</th>
                                  <th>executor</th>
                                  <th>error</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.rows.map((r) => (
                                  <tr key={r.id}>
                                    <td>{r.id}</td>
                                    <td>{r.create_time}</td>
                                    <td>{r.start_time}</td>
                                    <td>{r.end_time}</td>
                                    <td>{r.status}</td>
                                    <td>{r.executor ?? ''}</td>
                                    <td>{r.error_message ?? ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : null}

                          {!isSystem ? (
                            <div className="task-sched-expr-edit">
                              <span>
                                {t.schedule_kind === 'cron'
                                  ? '修改 cron 表达式（五段或六段）'
                                  : '修改 once 触发时间字符串（将写入 schedule_expr 与 next_run_time）'}
                              </span>
                              <input
                                value={exprDraftById[t.id] ?? t.schedule_expr}
                                onChange={(e) =>
                                  setExprDraftById((prev) => ({ ...prev, [t.id]: e.target.value }))
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
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirm.kind ? (
        <div className="task-sched-modal-mask" role="dialog" aria-modal="true">
          <div className="task-sched-modal">
            <h3>
              {confirm.kind === 'saveExpr'
                ? '确认保存调度表达式'
                : confirm.kind === 'trigger'
                  ? '确认立即执行'
                  : confirm.kind === 'delete'
                    ? '确认删除任务'
                    : '执行 UPDATE SQL'}
            </h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{confirm.message}</p>
            {confirm.kind === 'saveExpr' ? (
              <textarea
                value={confirm.scheduleExprDraft || ''}
                onChange={(e) =>
                  setConfirm((c) =>
                    c.kind === 'saveExpr' ? { ...c, scheduleExprDraft: e.target.value } : c,
                  )
                }
              />
            ) : null}
            {confirm.kind === 'execSql' ? (
              <textarea
                placeholder="UPDATE task_schedule SET ... WHERE id = 1"
                value={confirm.sqlDraft || ''}
                onChange={(e) => setConfirm((c) => ({ ...c, sqlDraft: e.target.value }))}
              />
            ) : null}
            <div className="task-sched-modal-actions">
              <button type="button" className="task-sched-btn" onClick={() => setConfirm({ kind: null })}>
                取消
              </button>
              {confirm.kind === 'saveExpr' ? (
                <button type="button" className="task-sched-btn primary" disabled={busyId != null} onClick={() => void doSaveExpr()}>
                  确认保存
                </button>
              ) : null}
              {confirm.kind === 'trigger' ? (
                <button type="button" className="task-sched-btn primary" onClick={() => void doTrigger()}>
                  确认执行
                </button>
              ) : null}
              {confirm.kind === 'delete' ? (
                <button type="button" className="task-sched-btn danger" onClick={() => void doDelete()}>
                  确认删除
                </button>
              ) : null}
              {confirm.kind === 'execSql' ? (
                <button type="button" className="task-sched-btn primary" onClick={() => void doExecSql()}>
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
