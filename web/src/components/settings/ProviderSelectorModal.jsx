import { useState } from "react";
import React from "react";
import { X, Plus, Globe } from "lucide-react";
import { getProviderIcon, getProviderName } from "./settingsUtils";

/**
 * 供应商选择弹窗：显示所有内置模板 + 自定义选项
 */
function ProviderSelectorModal({ builtinTemplates, currentProviderIds, onSelect, onClose }) {
  const [searchText, setSearchText] = useState("");

  // 过滤出未添加的内置模板
  const availableBuiltin = builtinTemplates.filter(
    (t) => !currentProviderIds.has(t.id),
  );

  // 按搜索文本过滤
  const filtered = searchText
    ? availableBuiltin.filter(
        (t) =>
          t.id.toLowerCase().includes(searchText.toLowerCase()) ||
          t.name.toLowerCase().includes(searchText.toLowerCase()),
      )
    : availableBuiltin;

  return (
    <div className="provider-modal-overlay" onClick={onClose}>
      <div className="provider-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="provider-modal-header">
          <h3>选择提供商</h3>
          <button className="provider-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="provider-modal-search">
          <input
            type="text"
            className="provider-modal-search-input"
            placeholder="搜索提供商..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>

        {/* Provider list */}
        <div className="provider-modal-list">
          {filtered.map((template) => {
            const icon = getProviderIcon(template.id);
            const name = getProviderName(template.id, template);
            const isIconComponent = typeof icon === "function" || (icon && typeof icon === "object" && icon.$$typeof);
            
            return (
              <button
                key={template.id}
                className="provider-modal-item"
                onClick={() => onSelect({ type: "builtin", id: template.id })}
              >
                <span className="provider-modal-item-icon">
                  {isIconComponent ? (
                    React.createElement(icon, { size: 20 })
                  ) : (
                    String(icon)
                  )}
                </span>
                <span className="provider-modal-item-info">
                  <span className="provider-modal-item-name">{String(name)}</span>
                  <span className="provider-modal-item-id">{String(template.id)}</span>
                </span>
              </button>
            );
          })}

          {filtered.length === 0 && (
            <div className="provider-modal-empty">
              {searchText ? "没有找到匹配的提供商" : "所有内置提供商已添加"}
            </div>
          )}
        </div>

        {/* Custom provider option */}
        <div className="provider-modal-footer">
          <button
            className="provider-modal-custom-btn"
            onClick={() => onSelect({ type: "custom" })}
          >
            <Plus size={16} />
            <span>添加自定义提供商</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProviderSelectorModal;
