// @ts-nocheck
import { useState } from "react";
import MessageManager from "../Message";
import {
  LOCAL_MEMORY_MODEL,
  LOCAL_EMBEDDING_DIMENSIONS,
} from "./constants";
import {
  buildMemorySearchPayloadForTest,
  buildMemorySearchForSave,
} from "./memorySearchPayload";
import { deepDiff } from "./settingsUtils";
import {
  testMemorySearchConfig,
  repairLocalMemorySearch,
  patchFgbgConfig,
} from "../../api/client";

/**
 * Hook: Memory/Heartbeat tab 的状态和 handlers
 */
export function useMemoryConfig({ rawConfig, baseConfig, setRawConfig, setBaseConfig, setMetadata }) {
  const [memoryHeartbeatForm, setMemoryHeartbeatForm] = useState({
    mode: "local",
    model: LOCAL_MEMORY_MODEL,
    endpoint: "",
    apiKey: "",
    chunkMaxChars: 500,
    embeddingDimensions: LOCAL_EMBEDDING_DIMENSIONS,
    downloadEnabled: true,
    downloadUrl: "",
    downloadTimeout: 300000,
    heartbeatEnabled: true,
    intervalMs: 1000,
    concurrency: 2,
    allowedScripts: "[]",
  });
  const [showMemoryApiKey, setShowMemoryApiKey] = useState(false);
  const [memorySearchTesting, setMemorySearchTesting] = useState(false);
  const [memorySearchRepairing, setMemorySearchRepairing] = useState(false);
  const [memorySearchTestResult, setMemorySearchTestResult] = useState(null);
  const [memorySearchTestHint, setMemorySearchTestHint] = useState("");
  const [memorySearchTestFix, setMemorySearchTestFix] = useState(null);

  const handleTestMemorySearch = async () => {
    setMemorySearchTestFix(null);
    if (memoryHeartbeatForm.mode === "local") {
      if (!String(memoryHeartbeatForm.model || "").trim()) {
        setMemorySearchTestResult("error");
        setMemorySearchTestHint("本地模式请先填写嵌入模型（文件名或路径）。");
        setMemorySearchTestFix("local-download");
        return;
      }
    } else {
      if (!String(memoryHeartbeatForm.endpoint || "").trim()) {
        setMemorySearchTestResult("error");
        setMemorySearchTestHint("远程模式请先填写 endpoint。");
        setMemorySearchTestFix("remote-downgrade");
        return;
      }
      if (!String(memoryHeartbeatForm.apiKey || "").trim()) {
        setMemorySearchTestResult("error");
        setMemorySearchTestHint("远程模式请先填写 API Key。");
        setMemorySearchTestFix("remote-downgrade");
        return;
      }
    }
    setMemorySearchTesting(true);
    setMemorySearchTestResult(null);
    setMemorySearchTestHint("");
    try {
      const memorySearch = buildMemorySearchPayloadForTest(memoryHeartbeatForm, rawConfig);
      const payload = await testMemorySearchConfig(memorySearch);
      const baseHint = `${payload.mode} · 维度 ${payload.dimensions} · ${payload.durationMs} ms`;
      setMemorySearchTestResult("success");
      setMemorySearchTestHint(payload.warning ? `${baseHint} · ${payload.warning}` : baseHint);
      setMemorySearchTestFix(null);
    } catch (error) {
      setMemorySearchTestResult("error");
      setMemorySearchTestHint(error?.message || String(error));
      setMemorySearchTestFix(memoryHeartbeatForm.mode === "local" ? "local-download" : "remote-downgrade");
    } finally {
      setMemorySearchTesting(false);
    }
  };

  const handleRepairLocalMemory = async () => {
    if (!rawConfig) return;
    const payload = buildMemorySearchPayloadForTest({ ...memoryHeartbeatForm, mode: "local" }, rawConfig);
    setMemorySearchRepairing(true);
    try {
      await repairLocalMemorySearch(payload);
      MessageManager.success("已按当前表单尝试下载/修复本地模型，完成后请再次点击「测试连接」。");
      setMemorySearchTestFix(null);
    } catch (error) {
      setMemorySearchTestHint(error?.message || String(error));
    } finally {
      setMemorySearchRepairing(false);
    }
  };

  const handleDowngradeToLocal = () => {
    setMemoryHeartbeatForm((prev) => ({
      ...prev,
      mode: "local",
      model: LOCAL_MEMORY_MODEL,
      embeddingDimensions: LOCAL_EMBEDDING_DIMENSIONS,
    }));
    setMemorySearchTestResult(null);
    setMemorySearchTestHint("");
    setMemorySearchTestFix(null);
    MessageManager.info("已切换为本地模式，请填写嵌入模型并保存后再测试。");
  };

  const handleSaveMemoryHeartbeat = async () => {
    if (!rawConfig || !baseConfig) return;
    if (memoryHeartbeatForm.mode === "remote") {
      if (!String(memoryHeartbeatForm.endpoint || "").trim()) {
        MessageManager.info("远程模式下请填写 endpoint。");
        return;
      }
      if (!String(memoryHeartbeatForm.apiKey || "").trim()) {
        MessageManager.info("远程模式下请填写 API Key。");
        return;
      }
    }
    if (memoryHeartbeatForm.mode === "local") {
      if (!String(memoryHeartbeatForm.model || "").trim()) {
        MessageManager.info("本地模式下请填写嵌入模型。");
        return;
      }
    }

    try {
      const draft = typeof structuredClone === "function" ? structuredClone(rawConfig) : JSON.parse(JSON.stringify(rawConfig || {}));
      const memorySearch = buildMemorySearchForSave(memoryHeartbeatForm);

      if (!draft.agents) draft.agents = {};
      draft.agents.memorySearch = memorySearch;
      if (!draft.heartbeat) draft.heartbeat = {};
      draft.heartbeat.enabled = memoryHeartbeatForm.heartbeatEnabled;
      draft.heartbeat.intervalMs = memoryHeartbeatForm.intervalMs;
      draft.heartbeat.concurrency = memoryHeartbeatForm.concurrency;
      draft.heartbeat.allowedScripts = JSON.parse(memoryHeartbeatForm.allowedScripts || "[]");

      const patch = deepDiff(draft, baseConfig);
      if (patch && Object.keys(patch).length > 0) {
        const payload = await patchFgbgConfig(patch);
        setRawConfig(payload.config);
        setBaseConfig(payload.config);
        setMetadata(payload.metadata || {});
      }
      MessageManager.success("保存成功");
    } catch (error) {
      MessageManager.error(`保存失败: ${error.message}`);
    }
  };

  return {
    memoryHeartbeatForm,
    setMemoryHeartbeatForm,
    showMemoryApiKey,
    setShowMemoryApiKey,
    memorySearchTesting,
    memorySearchRepairing,
    memorySearchTestResult,
    memorySearchTestHint,
    memorySearchTestFix,
    setMemorySearchTestFix,
    handleTestMemorySearch,
    handleRepairLocalMemory,
    handleDowngradeToLocal,
    handleSaveMemoryHeartbeat,
  };
}
