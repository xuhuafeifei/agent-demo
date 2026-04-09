// @ts-nocheck - Component will be gradually typed in Phase 4
import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

// ─── Toggle Switch Component ────────────────────────────────────────
export function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`settings-toggle ${checked ? "on" : "off"} ${
        disabled ? "disabled" : ""
      }`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

// ─── Collapsible Section ────────────────────────────────────────────
export function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="settings-collapsible">
      <button
        type="button"
        className="settings-collapsible-header"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>{title}</span>
      </button>
      {open ? (
        <div className="settings-collapsible-body">{children}</div>
      ) : null}
    </div>
  );
}

// ─── Combobox (dropdown + text input) ───────────────────────────────
export function ModelCombobox({
  value,
  options,
  onChange,
  placeholder,
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    if (!filter) return options;
    const lower = filter.toLowerCase();
    return options.filter(
      (o) =>
        o.id.toLowerCase().includes(lower) ||
        o.name.toLowerCase().includes(lower),
    );
  }, [options, filter]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleSelect = (id) => {
    onChange(id);
    setOpen(false);
    setFilter("");
  };

  const handleBlur = () => {
    // Delay to allow option click to fire first
    setTimeout(() => {
      if (filter) {
        // If user typed something, use it as the value
        onChange(filter);
      }
      setOpen(false);
      setFilter("");
    }, 150);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filter) {
        onChange(filter);
        setOpen(false);
        setFilter("");
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setFilter("");
    }
  };

  return (
    <div className="settings-combobox" ref={wrapperRef}>
      <div className="settings-combobox-input-row">
        <input
          ref={inputRef}
          type="text"
          className="settings-form-input"
          value={open ? filter : value}
          placeholder={placeholder}
          onChange={(e) => {
            setFilter(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="settings-combobox-arrow"
          onClick={() => {
            setOpen((v) => !v);
            setFilter("");
          }}
        >
          {open ? <ChevronDown size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {open && (
        <div className="settings-combobox-dropdown">
          {filtered.length === 0 ? (
            <div className="settings-combobox-empty">
              按 Enter 使用自定义模型: <strong>{filter}</strong>
            </div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`settings-combobox-option ${
                  opt.id === value ? "selected" : ""
                }`}
                onClick={() => handleSelect(opt.id)}
              >
                <span className="settings-combobox-option-id">{opt.id}</span>
                {opt.name !== opt.id && (
                  <span className="settings-combobox-option-name">
                    {opt.name}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Provider List Item ─────────────────────────────────────────────
export function ProviderListItem({
  provider,
  selected,
  onSelect,
  onToggle,
}) {
  void onToggle; // currently unused (kept for API compatibility)

  const IconEl = provider.icon;
  const isComponent =
    typeof IconEl === "function" || (IconEl && IconEl.$$typeof);

  return (
    <button
      type="button"
      className={`settings-provider-item ${selected ? "selected" : ""}`}
      onClick={() => onSelect(provider.id)}
    >
      <span className="settings-provider-icon">
      {isComponent ? React.createElement(IconEl, { size: 20 }) : String(IconEl)}
    </span>
      <span className="settings-provider-name">{provider.name}</span>
      {provider.featureCount ? (
        <span className="settings-provider-badge">{provider.featureCount}</span>
      ) : null}
    </button>
  );
}

