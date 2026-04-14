// @ts-nocheck
import MessageManager from "../Message";
import { deepDiff } from "./settingsUtils";
import {
  patchFgbgConfig,
  evictLoggingCache,
  startQqLayerIfIdle,
  stopQqLayer,
  weixinSetPrimary,
} from "../../api/client";

/**
 * Hook: 各 tab 的 Save handlers
 */
export function useSaveHandlers({ rawConfig, baseConfig, setRawConfig, setBaseConfig, setMetadata, setSaving }) {
  const handleSaveLogging = async (loggingForm) => {
    if (!rawConfig || !baseConfig) return;
    setSaving(true);
    try {
      const draft = typeof structuredClone === "function" ? structuredClone(rawConfig) : JSON.parse(JSON.stringify(rawConfig || {}));
      const logDir = loggingForm.logDir.replace(/\/+$/, "");
      const fullFile = `${logDir}/fgbg-YYYY-MM-DD.log`;
      if (!draft.logging) draft.logging = {};
      draft.logging.cacheTimeSecond = loggingForm.cacheTimeSecond;
      draft.logging.level = loggingForm.level;
      draft.logging.file = fullFile;
      draft.logging.consoleLevel = loggingForm.consoleLevel;
      draft.logging.consoleStyle = loggingForm.consoleStyle;
      draft.logging.allowModule = loggingForm.allowModule;

      const patch = deepDiff(draft, baseConfig);
      if (patch && Object.keys(patch).length > 0) {
        const payload = await patchFgbgConfig(patch);
        setRawConfig(payload.config);
        setBaseConfig(payload.config);
        setMetadata(payload.metadata || {});
      }
      await evictLoggingCache();
      MessageManager.success("保存成功");
    } catch (error) {
      MessageManager.error(`保存失败: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveChannels = async (channelsForm, setChannelsForm) => {
    if (!rawConfig || !baseConfig) return;
    if (channelsForm.qqbotEnabled) {
      if (!channelsForm.qqbotAppId.trim()) {
        MessageManager.info("开启 QQBot 通道时，AppId 不能为空。");
        return;
      }
      if (!channelsForm.qqbotClientSecret.trim() && !channelsForm.qqbotHasCredentials) {
        MessageManager.info("开启 QQBot 通道时，Client Secret 不能为空（若此前已保存过密钥，可留空不修改）。");
        return;
      }
    }
    setSaving(true);
    try {
      const draft = typeof structuredClone === "function" ? structuredClone(rawConfig) : JSON.parse(JSON.stringify(rawConfig || {}));
      if (!draft.channels) draft.channels = {};
      const baseQq = baseConfig.channels?.qqbot ?? {};
      draft.channels.qqbot = {
        ...baseQq,
        enabled: channelsForm.qqbotEnabled,
        appId: channelsForm.qqbotAppId.trim(),
      };
      if (channelsForm.qqbotClientSecret.trim()) {
        draft.channels.qqbot.clientSecret = channelsForm.qqbotClientSecret.trim();
      }
      draft.channels.weixin = {
        ...(baseConfig.channels?.weixin ?? {}),
        enabled: channelsForm.weixinEnabled,
      };

      const patch = deepDiff(draft, baseConfig);
      if (patch && Object.keys(patch).length > 0) {
        const payload = await patchFgbgConfig(patch);
        setRawConfig(payload.config);
        setBaseConfig(payload.config);
        setMetadata(payload.metadata || {});
        const hc = payload.config?.channels?.qqbot?.hasCredentials;
        if (typeof hc === "boolean") {
          setChannelsForm((prev) => ({ ...prev, qqbotHasCredentials: hc }));
        }
      }

      const pendingPrimary = channelsForm.weixinPrimaryPending?.trim();
      if (pendingPrimary) {
        await weixinSetPrimary(pendingPrimary);
        setChannelsForm((prev) => ({ ...prev, weixinPrimaryPending: "" }));
      }

      if (channelsForm.qqbotEnabled) await startQqLayerIfIdle();
      else await stopQqLayer();

      MessageManager.success("保存成功");
    } catch (error) {
      MessageManager.error(`保存失败: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return { handleSaveLogging, handleSaveChannels };
}
