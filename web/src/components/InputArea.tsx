import React from 'react';
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  AtSign,
  Paperclip,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Check,
} from 'lucide-react';
import type { RefObject, ReactNode } from 'react';
import { useChatStore } from '../store/chatStore';
import { getFgbgConfig, setPrimaryModel } from '../api/configApi';
import { getProviderIcon, getProviderName } from './settings/settingsUtils';
import type { ComponentType } from 'react';

/**
 * 模型选项
 */
interface ModelItem {
  id: string;
  label: string;
}

/**
 * 模型分组
 */
interface ModelGroup {
  providerId: string;
  icon: ReactNode;
  name: string;
  models: ModelItem[];
}

/**
 * InputArea 组件 props
 */
interface InputAreaProps {
  onSend: (text: string) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  showScrollButton: boolean;
}

interface ProviderInfo {
  providerId: string;
  icon: ReactNode;
  name: string;
  isIconComponent: boolean;
}

/**
 * 底部输入框组件
 */
export default function InputArea({
  onSend,
  scrollRef,
  showScrollButton,
}: InputAreaProps) {
  const [value, setValue] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [primaryModel, setPrimaryModelState] = useState('');
  const [groupedModels, setGroupedModels] = useState<ModelGroup[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isStreaming = useChatStore((state) => state.isStreaming);

  const canSend = value.trim().length > 0 && !isStreaming;

  // 加载可用模型列表
  useEffect(() => {
    let mounted = true;
    async function loadModels() {
      setLoadingModels(true);
      try {
        const res = await getFgbgConfig() as any;
        if (!mounted) return;

        const providers = res.config?.models?.providers || {};
        const primary = res.config?.agents?.defaults?.model?.primary || '';

        setPrimaryModelState(primary);

        // 构建按供应商分组的模型列表
        const groups: ModelGroup[] = [];
        Object.entries(providers).forEach(
          ([providerId, providerCfg]: [string, any]) => {
            if (providerCfg.models && providerCfg.models.length > 0) {
              const icon = getProviderIcon(providerId) as ReactNode;
              const name = getProviderName(providerId);
              const models = providerCfg.models.map((m: { id: string; name?: string }) => ({
                id: `${providerId}/${m.id}`,
                label: m.name || m.id,
              }));
              groups.push({ providerId, icon, name, models });
            }
          }
        );

        setGroupedModels(groups);
      } catch (error) {
        if (mounted) {
          console.error('Failed to load models:', error);
        }
      } finally {
        if (mounted) setLoadingModels(false);
      }
    }
    loadModels();
    return () => {
      mounted = false;
    };
  }, []);

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 选择主模型
  const handleSelectModel = async (modelId: string) => {
    try {
      await setPrimaryModel(modelId);
      setPrimaryModelState(modelId);
      setShowModelDropdown(false);
    } catch (error) {
      console.error('Failed to set primary model:', error);
    }
  };

  // 当前主模型的供应商信息
  const currentProviderInfo = useMemo((): ProviderInfo | null => {
    if (!primaryModel) return null;
    const providerId = primaryModel.split('/')[0];
    const icon = getProviderIcon(providerId) as ReactNode;
    const name = getProviderName(providerId);
    const isIconComponent =
      typeof icon === 'function' ||
      (icon && typeof icon === 'object' && '$$typeof' in icon);
    return { providerId, icon, name, isIconComponent };
  }, [primaryModel]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <section className="input-wrap">
      <div className="input-card">
        {showScrollButton && (
          <button
            className="scroll-to-bottom-btn"
            type="button"
            aria-label="滚动到底部"
            onClick={scrollToBottom}
          >
            <ArrowDown size={16} />
          </button>
        )}
        <textarea
          ref={textareaRef}
          className="input-textarea"
          rows={1}
          value={value}
          placeholder="继续提问，或输入 @ 来引用内容"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && canSend) {
              e.preventDefault();
              const text = value.trim();
              setValue('');
              onSend(text);
            }
          }}
        />

        <div className="input-actions">
          <div className="left-tools">
            <button className="tool-btn" type="button" aria-label="提及">
              <AtSign size={18} />
            </button>
            <button className="tool-btn" type="button" aria-label="上传附件">
              <Paperclip size={18} />
            </button>
          </div>
          <div className="right-tools">
            {/* 模型选择下拉框 */}
            <div className="model-selector" ref={dropdownRef}>
              <button
                className="model-btn"
                type="button"
                aria-label="模型选择"
                onClick={() => setShowModelDropdown((prev) => !prev)}
              >
                {currentProviderInfo ? (
                  <>
                    <span className="model-btn-icon">
                      {currentProviderInfo.isIconComponent
                        ? React.createElement(
                            currentProviderInfo.icon as unknown as ComponentType<any>,
                            { size: 16 }
                          )
                        : String(currentProviderInfo.icon)}
                    </span>
                    <span className="model-btn-label">
                      {currentProviderInfo.name}
                    </span>
                  </>
                ) : (
                  <span className="model-btn-label">选择模型</span>
                )}
                <ChevronDown size={14} />
              </button>

              {showModelDropdown && (
                <div className="model-dropdown">
                  {loadingModels ? (
                    <div className="model-dropdown-loading">加载中...</div>
                  ) : groupedModels.length === 0 ? (
                    <div className="model-dropdown-empty">
                      请先在设置中配置模型
                    </div>
                  ) : (
                    groupedModels.map((group) => (
                      <div key={group.providerId} className="model-group">
                        <div className="model-group-header">
                          <span className="model-group-icon">
                            {typeof group.icon === 'function' ||
                            (group.icon &&
                              typeof group.icon === 'object' &&
                              '$$typeof' in group.icon)
                              ? React.createElement(
                                  group.icon as unknown as ComponentType<any>,
                                  { size: 14 }
                                )
                              : String(group.icon)}
                          </span>
                          <span className="model-group-name">{group.name}</span>
                        </div>
                        <div className="model-group-items">
                          {group.models.map((model) => (
                            <button
                              key={model.id}
                              className={`model-dropdown-item ${primaryModel === model.id ? 'active' : ''}`}
                              onClick={() => handleSelectModel(model.id)}
                            >
                              <span className="model-dropdown-item-label">
                                {model.label}
                              </span>
                              {primaryModel === model.id && (
                                <Check
                                  size={14}
                                  className="model-dropdown-item-check"
                                />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <button
              className={`send-btn ${canSend ? 'active' : 'disabled'}`}
              type="button"
              aria-label="发送消息"
              disabled={!canSend}
              onClick={() => {
                const text = value.trim();
                if (!text) return;
                setValue('');
                onSend(text);
              }}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
      <p className="input-hint">内容由 AI 生成仅供参考</p>
    </section>
  );
}
