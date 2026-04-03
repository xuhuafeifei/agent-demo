import { useEffect, useMemo, useState } from "react";
import {
  getFgbgConfig,
  patchFgbgConfig,
  resetFgbgConfig,
} from "../api/configApi";
import { SETTINGS_SECTIONS } from "../config/fgbgSchema";

function deepGet(obj, path) {
  return path
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function deepSet(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }
    if (
      typeof cursor[key] !== "object" ||
      cursor[key] === null ||
      Array.isArray(cursor[key])
    ) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  });
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function deepDiff(current, base) {
  if (deepEqual(current, base)) return undefined;
  if (!isPlainObject(current) || !isPlainObject(base)) return current;
  const out = {};
  Object.keys(current).forEach((key) => {
    const diff = deepDiff(current[key], base[key]);
    if (diff !== undefined) out[key] = diff;
  });
  return Object.keys(out).length ? out : undefined;
}

function safeStringify(value) {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseByField(field, rawValue) {
  if (field.type === "number") {
    const n = Number(rawValue);
    return Number.isNaN(n) ? rawValue : n;
  }
  if (field.type === "boolean") {
    return Boolean(rawValue);
  }
  if (field.type === "json") {
    if (!rawValue?.trim()) return null;
    return JSON.parse(rawValue);
  }
  return rawValue;
}

function validateField(field, parsedValue, fullDraft) {
  if (field.readOnly) return "";
  if (field.required && (parsedValue === "" || parsedValue == null)) {
    return `${field.label} 为必填`;
  }
  if (field.type === "number") {
    if (typeof parsedValue !== "number" || Number.isNaN(parsedValue)) {
      return `${field.label} 必须为数字`;
    }
    if (typeof field.min === "number" && parsedValue < field.min) {
      return `${field.label} 不能小于 ${field.min}`;
    }
    if (typeof field.max === "number" && parsedValue > field.max) {
      return `${field.label} 不能大于 ${field.max}`;
    }
  }
  if (field.type === "url" && parsedValue) {
    try {
      // eslint-disable-next-line no-new
      new URL(parsedValue);
    } catch {
      return `${field.label} 不是合法 URL`;
    }
  }
  if (
    field.path === "agents.memorySearch.endpoint" &&
    deepGet(fullDraft, "agents.memorySearch.mode") === "remote" &&
    !parsedValue
  ) {
    return "memorySearch.mode=remote 时 endpoint 必填";
  }
  if (
    field.path === "agents.memorySearch.apiKey" &&
    deepGet(fullDraft, "agents.memorySearch.mode") === "remote" &&
    !parsedValue
  ) {
    return "memorySearch.mode=remote 时 apiKey 必填";
  }
  return "";
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [rawConfig, setRawConfig] = useState(null);
  const [baseConfig, setBaseConfig] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [visibleSensitive, setVisibleSensitive] = useState({});

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setMessage("");
      try {
        const payload = await getFgbgConfig();
        if (!mounted) return;
        setRawConfig(payload.config);
        setBaseConfig(payload.config);
        setMetadata(payload.metadata || {});
        const nextValues = {};
        SETTINGS_SECTIONS.forEach((section) => {
          section.fields.forEach((field) => {
            const value = deepGet(payload.config, field.path);
            nextValues[field.path] =
              field.type === "json" ? safeStringify(value) : (value ?? "");
          });
        });
        setFormValues(nextValues);
      } catch (error) {
        if (mounted) setMessage(`加载配置失败: ${error.message}`);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const protectedPathSet = useMemo(
    () => new Set(metadata?.protectedPaths || []),
    [metadata],
  );

  const defaultPathSet = useMemo(
    () => new Set(metadata?.defaultPaths || []),
    [metadata],
  );

  const handleChange = (field, nextRawValue) => {
    setFormValues((prev) => ({
      ...prev,
      [field.path]: nextRawValue,
    }));
    setErrors((prev) => ({
      ...prev,
      [field.path]: "",
    }));
  };

  const buildDraftAndErrors = () => {
    const draft =
      typeof structuredClone === "function"
        ? structuredClone(rawConfig)
        : JSON.parse(JSON.stringify(rawConfig || {}));
    const nextErrors = {};
    SETTINGS_SECTIONS.forEach((section) => {
      section.fields.forEach((field) => {
        if (field.readOnly || protectedPathSet.has(field.path)) return;
        try {
          const parsed = parseByField(field, formValues[field.path]);
          const maybeError = validateField(field, parsed, draft);
          if (maybeError) {
            nextErrors[field.path] = maybeError;
            return;
          }
          deepSet(draft, field.path, parsed);
        } catch {
          nextErrors[field.path] = `${field.label} 格式不合法`;
        }
      });
    });
    return { draft, nextErrors };
  };

  const handleSave = async () => {
    if (!rawConfig || !baseConfig) return;
    setMessage("");
    const { draft, nextErrors } = buildDraftAndErrors();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setMessage("保存失败：请先修正表单错误。");
      return;
    }
    const patch = deepDiff(draft, baseConfig);
    if (!patch || Object.keys(patch).length === 0) {
      setMessage("没有检测到变更。");
      return;
    }

    setSaving(true);
    try {
      const payload = await patchFgbgConfig(patch);
      setRawConfig(payload.config);
      setBaseConfig(payload.config);
      setMetadata(payload.metadata || {});
      setMessage("保存成功。");
    } catch (error) {
      setMessage(`保存失败: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setMessage("");
    setResetting(true);
    try {
      const payload = await resetFgbgConfig();
      setRawConfig(payload.config);
      setBaseConfig(payload.config);
      setMetadata(payload.metadata || {});
      const nextValues = {};
      SETTINGS_SECTIONS.forEach((section) => {
        section.fields.forEach((field) => {
          const value = deepGet(payload.config, field.path);
          nextValues[field.path] =
            field.type === "json" ? safeStringify(value) : (value ?? "");
        });
      });
      setFormValues(nextValues);
      setErrors({});
      setMessage("已恢复默认配置。");
    } catch (error) {
      setMessage(`恢复默认失败: ${error.message}`);
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <section className="settings-page">
        <div className="settings-toolbar">配置加载中...</div>
      </section>
    );
  }

  return (
    <section className="settings-page">
      <div className="settings-toolbar">
        <div className="settings-title-wrap">
          <h2>fgbg 配置中心</h2>
          <p>按模块编辑 `fgbg.json`，保存时仅提交增量 patch。</p>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="tool-btn"
            onClick={handleReset}
            disabled={resetting || saving}
          >
            {resetting ? "恢复中..." : "恢复默认"}
          </button>
          <button
            type="button"
            className="send-btn active"
            onClick={handleSave}
            disabled={saving || resetting}
          >
            {saving ? "保存中..." : "保存修改"}
          </button>
        </div>
      </div>

      {message ? <div className="settings-message">{message}</div> : null}

      <div className="settings-grid">
        {SETTINGS_SECTIONS.map((section) => (
          <article key={section.key} className="settings-card">
            <h3>{section.title}</h3>
            <div className="settings-fields">
              {section.fields.map((field) => {
                const protectedField = protectedPathSet.has(field.path);
                const fieldValue = formValues[field.path] ?? "";
                const isSensitive = field.type === "sensitive";
                const sensitiveVisible = !!visibleSensitive[field.path];
                const inputType = isSensitive
                  ? sensitiveVisible
                    ? "text"
                    : "password"
                  : "text";
                const readOnly = field.readOnly || protectedField;
                return (
                  <label className="settings-field" key={field.path}>
                    <div className="settings-label">
                      <span>{field.label}</span>
                      {readOnly ? <em>只读</em> : null}
                      {defaultPathSet.has(field.path) ? <i>默认值</i> : null}
                    </div>

                    {field.type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(fieldValue)}
                        disabled={readOnly}
                        onChange={(e) => handleChange(field, e.target.checked)}
                      />
                    ) : null}

                    {field.type === "select" ? (
                      <select
                        value={fieldValue}
                        disabled={readOnly}
                        onChange={(e) => handleChange(field, e.target.value)}
                      >
                        {(field.options || []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : null}

                    {field.type === "json" ? (
                      <textarea
                        rows={5}
                        value={fieldValue}
                        readOnly={readOnly}
                        onChange={(e) => handleChange(field, e.target.value)}
                      />
                    ) : null}

                    {!["boolean", "select", "json"].includes(field.type) ? (
                      <div className="settings-input-line">
                        <input
                          type={field.type === "number" ? "number" : inputType}
                          value={fieldValue}
                          readOnly={readOnly}
                          onChange={(e) => handleChange(field, e.target.value)}
                        />
                        {isSensitive && !readOnly ? (
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() =>
                              setVisibleSensitive((prev) => ({
                                ...prev,
                                [field.path]: !prev[field.path],
                              }))
                            }
                          >
                            {sensitiveVisible ? "隐藏" : "显示"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {errors[field.path] ? (
                      <span className="settings-error">
                        {errors[field.path]}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
