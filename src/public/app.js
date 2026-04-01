const chatContainer = document.getElementById("chat-thread");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const clearBtn = document.getElementById("clear-btn");
const schedulerList = document.getElementById("scheduler-list");
const schedulerDetail = document.getElementById("scheduler-detail");
const schedulerRefreshBtn = document.getElementById("scheduler-refresh-btn");
const schedulerNewBtn = document.getElementById("scheduler-new-btn");
const schedulerFilterButtons = Array.from(
  document.querySelectorAll(".scheduler-filter"),
);
const contextIndicator = document.querySelector(".context-indicator");
const contextIndicatorCircle = contextIndicator?.querySelector(
  "circle:nth-child(2)",
);
let lastContextSnapshotGlobal = "";
let autoScrollEnabled = true;
let scrollBottomBtn = null;

function isNearBottom(element, threshold = 36) {
  if (!element) return true;
  const distance =
    element.scrollHeight - (element.scrollTop + element.clientHeight);
  return distance <= threshold;
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn("Clipboard API failed, falling back", err);
  }

  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand("copy");
    textArea.remove();
    return successful;
  } catch (err) {
    console.error("Fallback clipboard failed", err);
    return false;
  }
}

function updateScrollBottomButtonVisibility() {
  if (!scrollBottomBtn) return;
  scrollBottomBtn.classList.toggle("visible", !autoScrollEnabled);
}

function refreshAutoScrollState() {
  autoScrollEnabled = isNearBottom(chatContainer);
  updateScrollBottomButtonVisibility();
}

function initScrollBottomButton() {
  const chatViewPanel = document.getElementById("chat-view");
  if (!chatViewPanel || scrollBottomBtn) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "scroll-bottom-btn";
  btn.textContent = "回到底部";
  btn.addEventListener("click", () => {
    autoScrollEnabled = true;
    chatContainer.scrollTo({
      top: chatContainer.scrollHeight,
      behavior: "smooth",
    });

    const openDetailsList = chatContainer.querySelectorAll("details[open]");
    if (openDetailsList.length > 0) {
      const lastOpenDetails = openDetailsList[openDetailsList.length - 1];
      const pres = lastOpenDetails.querySelectorAll("pre");
      pres.forEach((pre) => {
        pre.scrollTo({
          top: pre.scrollHeight,
          behavior: "smooth",
        });
      });
    }

    updateScrollBottomButtonVisibility();
  });
  chatViewPanel.appendChild(btn);
  scrollBottomBtn = btn;
  updateScrollBottomButtonVisibility();
}

const md = window.markdownit({
  html: false,
  linkify: true,
  breaks: true,
  highlight: function (str, lang) {
    let highlighted = "";
    if (lang && window.hljs && hljs.getLanguage(lang)) {
      try {
        highlighted = hljs.highlight(str, {
          language: lang,
          ignoreIllegals: true,
        }).value;
      } catch (__) {}
    }
    if (!highlighted) {
      highlighted = md.utils.escapeHtml(str);
    }
    return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-block-lang">${lang || ""}</span><button class="code-copy-btn">CV</button></div><pre class="hljs"><code>${highlighted}</code></pre></div>`;
  },
});
const schedulerState = {
  filter: "all",
  selectedId: "",
  tasks: [
    {
      id: "task-1",
      name: "每日知识库索引",
      status: "pending",
      cron: "0 8 * * *",
      desc: "每天早上整理新增知识片段。",
    },
    {
      id: "task-2",
      name: "上下文压缩巡检",
      status: "running",
      cron: "*/30 * * * *",
      desc: "半小时执行一次上下文压缩检查。",
    },
    {
      id: "task-3",
      name: "周报推送",
      status: "done",
      cron: "0 18 * * 5",
      desc: "每周五推送汇总报告到频道。",
    },
  ],
};

// Navigation handling - OpenClaw style sidebar
const navItems = Array.from(document.querySelectorAll(".nav-item"));
const navSections = Array.from(
  document.querySelectorAll(".nav-section__label"),
);
const navCollapseToggle = document.querySelector(".nav-collapse-toggle");
const sidebar = document.querySelector(".sidebar");
const shell = document.querySelector(".shell");
const breadcrumbCurrent = document.getElementById("breadcrumb-current");

const viewSwitchButtons = Array.from(
  document.querySelectorAll(".view-switch-btn"),
);
const mainLayout = document.getElementById("main-layout");
const chatView = document.getElementById("chat-view");
const schedulerView = document.getElementById("scheduler-view");
const configView = document.getElementById("config-view");

// View names for breadcrumb
const viewNames = {
  "#chat": "聊天",
  "#scheduler": "任务调度",
  "#config": "配置",
};

// Navigation section collapse handling
navSections.forEach((section) => {
  section.addEventListener("click", () => {
    const parent = section.closest(".nav-section");
    parent.classList.toggle("nav-section--collapsed");
  });
});

// Sidebar collapse toggle
navCollapseToggle?.addEventListener("click", () => {
  sidebar?.classList.toggle("sidebar--collapsed");
  shell?.classList.toggle("shell--nav-collapsed");
});

// Navigation item click handling
navItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const route = item.getAttribute("data-route");
    if (route) {
      // Update active state
      navItems.forEach((nav) => nav.classList.remove("active"));
      item.classList.add("active");

      // Update breadcrumb
      const viewName = viewNames[route] || "聊天";
      if (breadcrumbCurrent) {
        breadcrumbCurrent.textContent = viewName;
      }

      // Switch views
      switchView(route);
    }
  });
});

function switchView(route) {
  // Hide all views
  chatView?.classList.add("hidden");
  schedulerView?.classList.add("hidden");
  configView?.classList.add("hidden");

  // Show target view
  if (route === "#chat") {
    chatView?.classList.remove("hidden");
  } else if (route === "#scheduler") {
    schedulerView?.classList.remove("hidden");
  } else if (route === "#config") {
    configView?.classList.remove("hidden");
  }

  // Update content class for chat focus mode
  const content = document.getElementById("main-content");
  if (content) {
    content.classList.toggle("content--chat", route === "#chat");
  }
}
const configRefreshBtn = document.getElementById("config-refresh-btn");
const configResetBtn = document.getElementById("config-reset-btn");
const configSaveBtn = document.getElementById("config-save-btn");
const configRevertBtn = document.getElementById("config-revert-btn");
const configCardsContainer = document.getElementById("config-cards");
const configMetaUpdated = document.getElementById("config-meta-updated");
const configMetaState = document.getElementById("config-meta-state");
const configDefaultStripElement = document.getElementById(
  "config-default-strip",
);
const configToast = document.getElementById("config-toast");

const configState = {
  snapshot: null,
  metadata: null,
  patch: {},
  dirtyPaths: new Set(),
  isLoading: false,
  isSaving: false,
  initialized: false,
};

const LOGGING_LEVEL_OPTIONS = [
  { value: "trace", label: "trace" },
  { value: "debug", label: "debug" },
  { value: "info", label: "info" },
  { value: "warn", label: "warn" },
  { value: "error", label: "error" },
  { value: "fatal", label: "fatal" },
  { value: "silent", label: "silent" },
];

const CONSOLE_STYLE_OPTIONS = [
  { value: "pretty", label: "pretty" },
  { value: "common", label: "common" },
  { value: "json", label: "json" },
];

const configSections = [
  {
    id: "models",
    title: "模型",
    description: "调整默认模型模式与 qwen code 模型的状态。",
    fields: [
      {
        label: "模型模式",
        path: ["models", "mode"],
        type: "select",
        helper: "merge 会保留默认 provider，replace 会完全替换。",
        options: [
          { value: "merge", label: "merge（保留默认）" },
          { value: "replace", label: "replace（覆盖）" },
        ],
      },
    ],
    extra: (config) => createQwenProviderNote(config),
  },
  {
    id: "agents-defaults",
    title: "Agents · 默认",
    description: "限定 agent 默认使用的工作区与模型。",
    fields: [
      {
        label: "默认模型",
        path: ["agents", "defaults", "model", "primary"],
        type: "text",
        helper: "当用户未指定模型时，Agent 会使用此值。",
      },
      {
        label: "默认工作区",
        path: ["agents", "defaults", "workspace"],
        type: "text",
        helper: "应用默认工作区目录，支持绝对路径。",
      },
    ],
  },
  {
    id: "memory-search",
    title: "Agents · Memory Search",
    description: "内存搜索相关接口与缓存。",
    fields: [
      {
        label: "搜索模式",
        path: ["agents", "memorySearch", "mode"],
        type: "select",
        options: [
          { value: "local", label: "local" },
          { value: "remote", label: "remote" },
        ],
      },
      {
        label: "远程 Endpoint",
        path: ["agents", "memorySearch", "endpoint"],
        type: "text",
      },
      {
        label: "API Key",
        path: ["agents", "memorySearch", "apiKey"],
        type: "text",
      },
      {
        label: "Chunk 最大字符数",
        path: ["agents", "memorySearch", "chunkMaxChars"],
        type: "number",
        helper: "控制 local 模式下 chunk 的长度。",
      },
      {
        label: "Embedding 维度",
        path: ["agents", "memorySearch", "embeddingDimensions"],
        type: "number",
      },
      {
        label: "模型下载地址",
        path: ["agents", "memorySearch", "download", "url"],
        type: "text",
      },
    ],
  },
  {
    id: "logging",
    title: "Logging",
    description: "日志与控制台显示节奏。",
    fields: [
      {
        label: "日志级别",
        path: ["logging", "level"],
        type: "select",
        options: LOGGING_LEVEL_OPTIONS,
      },
      {
        label: "缓存时间（秒）",
        path: ["logging", "cacheTimeSecond"],
        type: "number",
        helper: "范围：60 ~ 300。",
      },
      {
        label: "日志文件位置",
        path: ["logging", "file"],
        type: "text",
      },
      {
        label: "控制台级别",
        path: ["logging", "consoleLevel"],
        type: "select",
        options: LOGGING_LEVEL_OPTIONS,
      },
      {
        label: "控制台样式",
        path: ["logging", "consoleStyle"],
        type: "select",
        options: CONSOLE_STYLE_OPTIONS,
      },
    ],
  },
  {
    id: "heartbeat",
    title: "Heartbeat",
    description: "控制心跳监控频率与并发。",
    fields: [
      {
        label: "心跳开关",
        path: ["heartbeat", "enabled"],
        type: "checkbox",
      },
      {
        label: "间隔 ms",
        path: ["heartbeat", "intervalMs"],
        type: "number",
      },
      {
        label: "并发线程",
        path: ["heartbeat", "concurrency"],
        type: "number",
      },
    ],
  },
  {
    id: "channels-qqbot",
    title: "Channels · QQ Bot",
    description: "QQ 通道配置。",
    fields: [
      {
        label: "启用 QQ Bot",
        path: ["channels", "qqbot", "enabled"],
        type: "checkbox",
      },
      {
        label: "App ID",
        path: ["channels", "qqbot", "appId"],
        type: "text",
      },
      {
        label: "Client Secret",
        path: ["channels", "qqbot", "clientSecret"],
        type: "text",
      },
      {
        label: "目标 OpenID",
        path: ["channels", "qqbot", "targetOpenid"],
        type: "text",
      },
    ],
  },
];

messageInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 130) + "px";
});

function renderMarkdown(text) {
  if (text == null || typeof text !== "string") return "";
  const raw = md.render(text);
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "s",
      "a",
      "code",
      "pre",
      "ul",
      "ol",
      "li",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "span",
      "div",
      "button",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "class", "data-language"],
  });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getMessageContent(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("");
  }
  return "";
}

function getAssistantStream(messageEl) {
  return messageEl?.querySelector(".timeline-stream");
}

function scrollToBottom(options = {}) {
  const { force = false } = options;
  if (!force && !autoScrollEnabled) return;
  chatContainer.scrollTop = chatContainer.scrollHeight;

  const openDetailsList = chatContainer.querySelectorAll("details[open]");
  if (openDetailsList.length > 0) {
    const lastOpenDetails = openDetailsList[openDetailsList.length - 1];
    const pres = lastOpenDetails.querySelectorAll("pre");
    pres.forEach((pre) => {
      pre.scrollTop = pre.scrollHeight;
    });
  }

  if (autoScrollEnabled) updateScrollBottomButtonVisibility();
}

function appendTimelineMarkdown(messageEl, text, className = "") {
  const stream = getAssistantStream(messageEl);
  if (!stream) return null;
  let node = stream.lastElementChild;
  if (
    !node ||
    !node.classList.contains("timeline-markdown") ||
    node.dataset.finished === "1"
  ) {
    node = document.createElement("div");
    node.className = `timeline-markdown ${className}`.trim();
    node.dataset.markdown = "";
    stream.appendChild(node);
  }
  node.dataset.markdown = text;
  node.innerHTML = renderMarkdown(text);
  return node;
}

function appendTimelineDetails(messageEl, kind, title, contentText) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;
  const details = document.createElement("details");
  details.className = `timeline-details ${kind}`;
  details.open = false;
  const summary = document.createElement("summary");
  summary.textContent = title;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "details-copy-btn";
  copyBtn.textContent = "CV";
  summary.appendChild(copyBtn);

  const pre = document.createElement("pre");
  pre.textContent = contentText;
  details.appendChild(summary);
  details.appendChild(pre);
  stream.appendChild(details);
  scrollToBottom();
}

function appendThinkingUpdate(messageEl, thinking) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;
  let details = stream.querySelector(
    "details.timeline-details.thinking[data-live='1']",
  );
  if (!details) {
    details = document.createElement("details");
    details.className = "timeline-details thinking";
    details.dataset.live = "1";
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "思考过程（实时）";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "details-copy-btn";
    copyBtn.textContent = "CV";
    summary.appendChild(copyBtn);

    details.appendChild(summary);
    details.appendChild(document.createElement("pre"));
    stream.appendChild(details);
  }
  details.querySelector("pre").textContent = thinking || "";
  scrollToBottom();
}

function finalizeAssistantBlocks(messageEl) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;
  stream.querySelectorAll("details.timeline-details").forEach((el) => {
    el.open = false;
    el.removeAttribute("data-live");
  });
}

function addMessage(
  content,
  role,
  id = `msg-${Date.now()}`,
  isStreaming = false,
) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${role}`;
  messageEl.id = id;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "U" : "A";
  messageEl.appendChild(avatar);

  const contentEl = document.createElement("div");
  contentEl.className = "content";
  messageEl.appendChild(contentEl);

  if (role === "assistant" || role === "user") {
    const msgCopyBtn = document.createElement("button");
    msgCopyBtn.className = "msg-copy-btn";
    msgCopyBtn.textContent = "CV";
    contentEl.appendChild(msgCopyBtn);
  }

  if (role === "assistant") {
    const stream = document.createElement("div");
    stream.className = "timeline-stream";
    contentEl.appendChild(stream);
    if (content) {
      appendTimelineMarkdown(messageEl, content);
    }
    if (isStreaming) {
      updateStreamingIndicator(messageEl, "Thinking");
    }
  } else {
    const body = document.createElement("div");
    body.className = "timeline-markdown user";
    body.innerHTML = renderMarkdown(content);
    contentEl.appendChild(body);
  }

  chatContainer.appendChild(messageEl);
  scrollToBottom({ force: true });
  return messageEl;
}

function removeStreamingIndicator(messageEl) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;
  const indicator = stream.querySelector(".streaming-indicator");
  if (indicator) indicator.remove();
}

function updateStreamingIndicator(messageEl, text) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;
  let indicator = stream.querySelector(".streaming-indicator");
  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = "streaming-indicator";
    stream.appendChild(indicator);
  }

  indicator.classList.remove("error");

  // Remove existing dots container if any
  const dots = indicator.querySelector(".dots");
  if (dots) dots.remove();

  // Set text and re-append dots
  indicator.textContent = text ? `${text} ` : "";

  const dotsContainer = document.createElement("span");
  dotsContainer.className = "dots";
  dotsContainer.innerHTML = "<span></span><span></span><span></span>";
  indicator.appendChild(dotsContainer);

  // Ensure indicator is always at the end
  stream.appendChild(indicator);
}

function appendTimestamp(messageEl, llmElapsedMs) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;
  const ts = document.createElement("div");
  ts.className = "timestamp";
  ts.textContent = `完成时间 ${new Date().toLocaleTimeString("zh-CN")}${typeof llmElapsedMs === "number" ? ` · LLM耗时 ${formatDuration(llmElapsedMs)}` : ""}`;
  stream.appendChild(ts);
  scrollToBottom();
}

function normalizeUiEvent(data) {
  if (data.uiEventType) return data;
  if (["message_start", "message_update", "message_end"].includes(data.type)) {
    return { ...data, uiEventType: "message", uiPayload: { phase: data.type } };
  }
  if (data.type === "thinking_update") {
    return {
      ...data,
      uiEventType: "thinking",
      uiPayload: { thinking: data.thinking, thinkingDelta: data.thinkingDelta },
    };
  }
  if (String(data.type || "").startsWith("tool_execution_")) {
    return { ...data, uiEventType: "tool", uiPayload: { phase: data.type } };
  }
  if (
    [
      "error",
      "auto_retry_start",
      "auto_retry_end",
      "compaction_start",
      "compaction_end",
    ].includes(data.type)
  ) {
    return { ...data, uiEventType: "context", uiPayload: { phase: data.type } };
  }
  return data;
}

function formatJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_err) {
    return String(value);
  }
}

function buildLineDiffUnified(oldText, newText, maxLines = 1200) {
  const oldLinesRaw = (oldText || "").split("\n");
  const newLinesRaw = (newText || "").split("\n");
  const oldLines = oldLinesRaw.slice(0, maxLines);
  const newLines = newLinesRaw.slice(0, maxLines);
  const truncated =
    oldLinesRaw.length > maxLines || newLinesRaw.length > maxLines;

  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push(` ${oldLines[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`-${oldLines[i]}`);
      i += 1;
    } else {
      out.push(`+${newLines[j]}`);
      j += 1;
    }
  }
  while (i < n) out.push(`-${oldLines[i++]}`);
  while (j < m) out.push(`+${newLines[j++]}`);
  if (truncated) out.push(` ...(diff truncated at ${maxLines} lines)`);
  return out;
}

function appendContextDiffBlock(
  messageEl,
  seq,
  reason,
  annotatedLines,
  currentSnapshot,
) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;
  const details = document.createElement("details");
  details.className = "timeline-details context";
  details.open = false;

  const summary = document.createElement("summary");
  summary.textContent = `上下文Diff #${seq} · ${reason}`;
  const cvButton = document.createElement("button");
  cvButton.type = "button";
  cvButton.className = "context-cv-btn";
  cvButton.textContent = "CV";
  cvButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const success = await copyToClipboard(currentSnapshot || "");
    if (success) {
      cvButton.textContent = "Copied";
      setTimeout(() => {
        cvButton.textContent = "CV";
      }, 1200);
    } else {
      cvButton.textContent = "Fail";
      setTimeout(() => {
        cvButton.textContent = "CV";
      }, 1200);
    }
  });
  summary.appendChild(cvButton);
  details.appendChild(summary);

  const container = document.createElement("div");
  container.className = "context-diff-container";

  const snapshotDetails = document.createElement("details");
  snapshotDetails.className = "context-subsection";
  snapshotDetails.open = false;
  const snapshotSummary = document.createElement("summary");
  snapshotSummary.textContent = "Current Context Snapshot";
  snapshotDetails.appendChild(snapshotSummary);
  const snapshotPre = document.createElement("pre");
  snapshotPre.className = "context-snapshot-pre";
  snapshotPre.textContent = currentSnapshot;
  snapshotDetails.appendChild(snapshotPre);
  container.appendChild(snapshotDetails);

  const annotatedDetails = document.createElement("details");
  annotatedDetails.className = "context-subsection";
  annotatedDetails.open = false;
  const annotatedSummary = document.createElement("summary");
  annotatedSummary.textContent = "Annotated Full Context";
  annotatedDetails.appendChild(annotatedSummary);
  const diffPre = document.createElement("pre");
  diffPre.className = "context-diff-pre";
  const linesToRender =
    annotatedLines.length > 0 ? annotatedLines : ["  (Empty context)"];
  linesToRender.forEach((line) => {
    const span = document.createElement("span");
    span.className = "context-diff-line";
    if (line.startsWith("+")) {
      span.classList.add("add");
    } else if (line.startsWith("-")) {
      span.classList.add("del");
    } else {
      span.classList.add("ctx");
    }
    span.textContent = line || " ";
    diffPre.appendChild(span);
  });
  annotatedDetails.appendChild(diffPre);
  container.appendChild(annotatedDetails);

  details.appendChild(container);
  stream.appendChild(details);
  scrollToBottom();
}

function updateTimelineError(messageEl, text) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;
  let errorEl = stream.querySelector(".timeline-error-text");
  if (!errorEl) {
    errorEl = document.createElement("div");
    errorEl.className = "timeline-error-text";
    stream.appendChild(errorEl);
  }
  errorEl.textContent = text;
  // Ensure it stays before the streaming indicator if present
  const indicator = stream.querySelector(".streaming-indicator");
  if (indicator) {
    stream.insertBefore(errorEl, indicator);
  } else {
    stream.appendChild(errorEl);
  }
  scrollToBottom();
}

function clearTimelineError(messageEl) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;
  const errorEl = stream.querySelector(".timeline-error-text");
  if (errorEl) errorEl.remove();
}

function finalizeCurrentThinking(messageEl, state) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;
  const liveThinking = stream.querySelectorAll(
    "details.timeline-details.thinking[data-live='1']",
  );
  liveThinking.forEach((el) => {
    el.removeAttribute("data-live");
    el.open = false;
  });
  if (state) {
    state.fullThinking = "";
  }
}

function handleStreamEvent(data, state, assistantMessageEl) {
  const event = normalizeUiEvent(data);
  const eventType = event.uiEventType;

  if (event.type === "context_used") {
    // 添加 context used 标签
    const tokenUsage = event.totalTokens;
    const contextWindow = event.contextWindow;
    const percentage = Math.round((tokenUsage / contextWindow) * 100);

    // 更新底部工具栏的 context indicator
    if (contextIndicator && contextIndicatorCircle) {
      const exactPercentage = ((tokenUsage / contextWindow) * 100).toFixed(1);
      contextIndicator.title = `${exactPercentage}% context used`;

      const circumference = 88; // 2 * pi * 14
      const offset = circumference - (circumference * percentage) / 100;
      contextIndicatorCircle.setAttribute("stroke-dashoffset", offset);

      // 根据使用量改变颜色
      const indicatorColor =
        percentage > 90
          ? "#ef4444" // 红色
          : percentage > 75
            ? "#f59e0b" // 黄色
            : "#94a3b8"; // 默认灰色
      contextIndicatorCircle.setAttribute("stroke", indicatorColor);
    }

    // 找到对话框内容元素
    const contentEl = assistantMessageEl.querySelector(".content");
    if (contentEl) {
      // 创建标签元素
      const usageTag = document.createElement("div");
      usageTag.className = "context-usage-tag";
      usageTag.textContent = `${percentage}%`;

      // 计算背景颜色（从绿色到红色渐变）
      const color =
        percentage > 90
          ? "#FF6B6B" // 红色
          : percentage > 75
            ? "#FFD93D" // 黄色
            : percentage > 50
              ? "#6BCF7F" // 浅绿色
              : "#4ECDC4"; // 蓝色

      usageTag.style.backgroundColor = color;

      contentEl.appendChild(usageTag);
    }

    console.log(
      `Context used: ${tokenUsage}/${contextWindow} (${percentage}%)`,
    );
    return;
  }

  if (event.type === "context_snapshot") {
    const current =
      typeof event.contextText === "string" ? event.contextText : "";
    const prev = state.prevContextText || "";
    const diffLines = buildLineDiffUnified(prev, current);
    state.prevContextText = current;
    lastContextSnapshotGlobal = current;
    appendContextDiffBlock(
      assistantMessageEl,
      event.seq ?? 0,
      event.reason ?? "unknown",
      diffLines,
      current,
    );
    return;
  }

  if (eventType === "message") {
    if (event.type === "message_start") {
      finalizeCurrentThinking(assistantMessageEl, state);
      state.fullText = ""; // Reset text for the new message/turn
      const stream = getAssistantStream(assistantMessageEl);
      if (
        stream &&
        stream.lastElementChild &&
        stream.lastElementChild.classList.contains("timeline-markdown")
      ) {
        stream.lastElementChild.dataset.finished = "1";
      }
      if (!state.llmStartedAt) {
        state.llmStartedAt = performance.now();
      }
      return;
    }
    if (event.type === "message_update") {
      finalizeCurrentThinking(assistantMessageEl, state);
      removeStreamingIndicator(assistantMessageEl);
      if (typeof event.delta === "string" && event.delta) {
        state.fullText += event.delta;
      } else if (typeof event.text === "string") {
        state.fullText = event.text;
      } else {
        state.fullText = getMessageContent(event.message || {});
      }
      appendTimelineMarkdown(assistantMessageEl, state.fullText);
      scrollToBottom();
      return;
    }
    if (event.type === "message_end") {
      finalizeCurrentThinking(assistantMessageEl, state);
      if (typeof event.text === "string" && event.text) {
        state.fullText = event.text;
      } else {
        state.fullText = getMessageContent(event.message || {});
      }
      if (!state.fullText) {
        return;
      }
      const node = appendTimelineMarkdown(assistantMessageEl, state.fullText);
      if (node) node.dataset.finished = "1";
      state.llmEndedAt = performance.now();
      return;
    }
  }

  if (eventType === "thinking") {
    if (typeof event.thinking === "string") state.fullThinking = event.thinking;
    if (typeof event.thinkingDelta === "string")
      state.fullThinking += event.thinkingDelta;
    appendThinkingUpdate(assistantMessageEl, state.fullThinking);
    updateStreamingIndicator(assistantMessageEl, "Thinking");
    return;
  }

  if (eventType === "tool") {
    finalizeCurrentThinking(assistantMessageEl, state);
    const payload = event.uiPayload || event;
    const title = `工具调用 · ${event.toolName || payload.toolName || "unknown"} · ${(payload.phase || event.type || "update").toString()}`;
    appendTimelineDetails(
      assistantMessageEl,
      "tool",
      title,
      formatJson(payload),
    );
    updateStreamingIndicator(
      assistantMessageEl,
      `Tooling: ${event.toolName || payload.toolName || "unknown"}`,
    );
    return;
  }

  if (eventType === "context") {
    if (event.type === "error") {
      // 确保 assistantMessageEl 存在且有 stream
      if (!assistantMessageEl) {
        // 如果没有当前的 assistant 消息元素，创建一个错误消息
        const errorEl = addMessage(
          `错误：${event.error || "未知错误"}`,
          "assistant",
          `msg-error-${Date.now()}`,
          false,
        );
        // 标记为错误消息
        errorEl.classList.add("is-error");
        return;
      }

      finalizeCurrentThinking(assistantMessageEl, state);
      updateTimelineError(
        assistantMessageEl,
        `错误：${event.error || "未知错误"}`,
      );
      updateStreamingIndicator(assistantMessageEl, "Error");
      const indicator = getAssistantStream(assistantMessageEl)?.querySelector(
        ".streaming-indicator",
      );
      if (indicator) indicator.classList.add("error");
      return;
    } else if (
      event.type === "auto_retry_start" &&
      event.attempt != null &&
      event.maxAttempts != null
    ) {
      if (!assistantMessageEl) return;
      finalizeCurrentThinking(assistantMessageEl, state);
      updateStreamingIndicator(
        assistantMessageEl,
        `Auto Retry (${event.attempt}/${event.maxAttempts})`,
      );
      const indicator = getAssistantStream(assistantMessageEl)?.querySelector(
        ".streaming-indicator",
      );
      if (indicator) indicator.classList.add("error");

      updateTimelineError(
        assistantMessageEl,
        `正在重试 (${event.attempt}/${event.maxAttempts})，原因：${event.errorMessage || "未知"}`,
      );
      return;
    } else if (event.type === "auto_retry_end") {
      if (!assistantMessageEl) return;
      const indicator = getAssistantStream(assistantMessageEl)?.querySelector(
        ".streaming-indicator",
      );
      if (indicator) indicator.classList.remove("error");
      if (!event.success) {
        updateStreamingIndicator(assistantMessageEl, "Retry Failed");
        if (indicator) indicator.classList.add("error");
        updateTimelineError(
          assistantMessageEl,
          `重试结束，未成功。${event.finalError ? " 原因：" + event.finalError : ""}`,
        );
      } else {
        updateStreamingIndicator(assistantMessageEl, "Thinking");
        clearTimelineError(assistantMessageEl);
      }
      return;
    } else if (event.type === "compaction_start") {
      if (!assistantMessageEl) return;
      finalizeCurrentThinking(assistantMessageEl, state);
      updateStreamingIndicator(assistantMessageEl, "Compressing Context...");
      return;
    } else if (event.type === "compaction_end") {
      if (!assistantMessageEl) return;
      const indicator = getAssistantStream(assistantMessageEl)?.querySelector(
        ".streaming-indicator",
      );
      if (event.error) {
        updateStreamingIndicator(assistantMessageEl, "Compression Failed");
        if (indicator) indicator.classList.add("error");
        updateTimelineError(assistantMessageEl, `压缩失败：${event.error}`);
      } else {
        if (indicator) indicator.classList.remove("error");
        updateStreamingIndicator(assistantMessageEl, "Thinking");
        appendTimelineDetails(
          assistantMessageEl,
          "context",
          "上下文变化 · compaction",
          event.tokensBefore
            ? `压缩完成，压缩前 Token 数：${event.tokensBefore}`
            : "会话已压缩过，跳过本次压缩",
        );
      }
      return;
    }
    // appendTimelineDetails(assistantMessageEl, "context", `上下文变化 · ${event.type}`, formatJson(event.uiPayload || event));
    return;
  }
}

async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  sendBtn.disabled = true;
  messageInput.disabled = true;

  addMessage(message, "user");
  messageInput.value = "";
  messageInput.style.height = "auto";

  const assistantMessageEl = addMessage(
    "",
    "assistant",
    `msg-${Date.now()}`,
    true,
  );
  const streamState = {
    fullText: "",
    fullThinking: "",
    llmStartedAt: 0,
    llmEndedAt: 0,
    prevContextText: lastContextSnapshotGlobal,
  };

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const eventBlock of events) {
        if (!eventBlock.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(eventBlock.slice(6));
          handleStreamEvent(event, streamState, assistantMessageEl);
        } catch (_err) {
          // Ignore malformed SSE events to keep UI resilient.
        }
      }
    }
  } catch (error) {
    appendTimelineDetails(
      assistantMessageEl,
      "context",
      "请求失败",
      String(error?.message || error),
    );
  } finally {
    removeStreamingIndicator(assistantMessageEl);
    finalizeAssistantBlocks(assistantMessageEl);
    appendTimestamp(
      assistantMessageEl,
      streamState.llmStartedAt && streamState.llmEndedAt
        ? Math.max(0, streamState.llmEndedAt - streamState.llmStartedAt)
        : undefined,
    );
    sendBtn.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
    scrollToBottom();
  }
}

async function clearHistory() {
  if (!confirm("确定要清除所有聊天历史吗？")) return;
  try {
    const response = await fetch("/api/clear", { method: "POST" });
    const data = await response.json();
    if (!data.success) throw new Error(data.error || "清除失败");
    chatContainer.innerHTML = "";
    addMessage(
      "您好！我是您的 AI 助手。左侧将展示对话、工具调用和上下文变化时间线。",
      "assistant",
    );
  } catch (error) {
    addMessage(`清除历史失败：${String(error?.message || error)}`, "assistant");
  }
}

function renderSchedulerList() {
  if (!schedulerList) return;
  schedulerList.innerHTML = "";
  const tasks = schedulerState.tasks.filter((task) =>
    schedulerState.filter === "all"
      ? true
      : task.status === schedulerState.filter,
  );
  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "scheduler-task";
    empty.textContent = "当前筛选下没有任务（占位）";
    schedulerList.appendChild(empty);
    return;
  }
  tasks.forEach((task) => {
    const item = document.createElement("div");
    item.className = `scheduler-task${schedulerState.selectedId === task.id ? " is-selected" : ""}`;
    item.innerHTML = `<div class="scheduler-task-title">${task.name}</div><div class="scheduler-task-meta">状态: ${task.status} · cron: ${task.cron}</div>`;
    item.addEventListener("click", () => {
      schedulerState.selectedId = task.id;
      renderSchedulerList();
      renderSchedulerDetail();
    });
    schedulerList.appendChild(item);
  });
}

function renderSchedulerDetail() {
  if (!schedulerDetail) return;
  const task = schedulerState.tasks.find(
    (t) => t.id === schedulerState.selectedId,
  );
  if (!task) {
    schedulerDetail.innerHTML =
      "<h3>任务详情</h3><p>选择右侧任务项查看详情。</p>";
    return;
  }
  schedulerDetail.innerHTML = `<h3>${task.name}</h3><p>状态：${task.status}<br>计划：${task.cron}<br>说明：${task.desc}</p>`;
}

function bindSchedulerActions() {
  schedulerFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      schedulerFilterButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      schedulerState.filter = button.dataset.filter || "all";
      renderSchedulerList();
    });
  });
  schedulerRefreshBtn?.addEventListener("click", () => {
    renderSchedulerList();
    renderSchedulerDetail();
  });
  schedulerNewBtn?.addEventListener("click", () => {
    alert("任务调度新建能力将在后续对接真实调度 API。");
  });
}

let toastTimer = 0;

function pathArrayToString(pathArray) {
  return pathArray.join(".");
}

function getValueByPath(source, pathArray) {
  if (!source || !Array.isArray(pathArray) || !pathArray.length)
    return undefined;
  return pathArray.reduce((acc, segment) => {
    if (acc && typeof acc === "object" && segment in acc) {
      return acc[segment];
    }
    return undefined;
  }, source);
}

function setNestedValue(target, pathArray, value) {
  let cursor = target;
  pathArray.forEach((segment, index) => {
    const isLast = index === pathArray.length - 1;
    if (isLast) {
      cursor[segment] = value;
      return;
    }
    if (!cursor[segment] || typeof cursor[segment] !== "object") {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  });
}

function deleteNestedValue(target, pathArray) {
  const stack = [];
  let cursor = target;
  pathArray.forEach((segment, index) => {
    if (!cursor || typeof cursor !== "object") return;
    stack.push({ parent: cursor, key: segment });
    cursor = cursor[segment];
  });
  const last = stack.pop();
  if (
    last &&
    last.parent &&
    Object.prototype.hasOwnProperty.call(last.parent, last.key)
  ) {
    delete last.parent[last.key];
  }
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const { parent, key } = stack[i];
    const child = parent[key];
    if (
      child &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      !Object.keys(child).length
    ) {
      delete parent[key];
    }
  }
}

function isSameValue(original, next) {
  if (original === next) return true;
  if (original == null && next == null) return true;
  if (
    typeof original === "number" &&
    typeof next === "number" &&
    Number.isNaN(original) &&
    Number.isNaN(next)
  ) {
    return true;
  }
  return false;
}

function updatePatch(pathArray, newValue) {
  const pathString = pathArrayToString(pathArray);
  const baseValue = getValueByPath(configState.snapshot, pathArray);
  if (isSameValue(baseValue, newValue)) {
    deleteNestedValue(configState.patch, pathArray);
    configState.dirtyPaths.delete(pathString);
  } else {
    setNestedValue(configState.patch, pathArray, newValue);
    configState.dirtyPaths.add(pathString);
  }
  updateButtons();
}

function createDefaultBadge() {
  const badge = document.createElement("span");
  badge.className = "field-default-indicator";
  badge.textContent = "默认";
  return badge;
}

function createFieldControl(field, pathString, controlId) {
  const fieldValue = getValueByPath(configState.snapshot, field.path);
  let control;
  if (field.type === "select") {
    control = document.createElement("select");
    control.id = controlId;
    (field.options || []).forEach((optionDef) => {
      const option = document.createElement("option");
      option.value = optionDef.value;
      option.textContent = optionDef.label ?? optionDef.value;
      control.appendChild(option);
    });
    const fallbackValue =
      field.options && field.options[0] ? field.options[0].value : "";
    control.value = fieldValue ?? fallbackValue;
  } else if (field.type === "number") {
    control = document.createElement("input");
    control.type = "number";
    control.id = controlId;
    control.value = fieldValue == null ? "" : String(fieldValue);
  } else if (field.type === "checkbox") {
    control = document.createElement("input");
    control.type = "checkbox";
    control.id = controlId;
    control.checked = Boolean(fieldValue);
  } else {
    control = document.createElement("input");
    control.type = "text";
    control.id = controlId;
    control.value = fieldValue == null ? "" : String(fieldValue);
  }

  control.dataset.path = pathString;
  control.dataset.fieldType = field.type;
  if (field.placeholder) {
    control.placeholder = field.placeholder;
  }
  const eventName = field.type === "checkbox" ? "change" : "input";
  control.addEventListener(eventName, (event) => {
    const target = event.target;
    let nextValue;
    if (field.type === "checkbox") {
      nextValue = target.checked;
    } else if (field.type === "number") {
      nextValue = target.value === "" ? undefined : Number(target.value);
      if (nextValue !== undefined && Number.isNaN(nextValue)) return;
    } else {
      nextValue = target.value;
    }
    updatePatch(field.path, nextValue);
  });

  return control;
}

function renderConfigCards() {
  if (!configCardsContainer) return;
  configCardsContainer.innerHTML = "";
  if (!configState.snapshot) {
    configCardsContainer.innerHTML = '<p class="muted">未加载配置</p>';
    return;
  }

  const defaults = configState.metadata?.defaultPaths || [];
  configSections.forEach((section) => {
    const card = document.createElement("div");
    card.className = "config-card";

    const header = document.createElement("div");
    header.className = "config-card-header";
    const title = document.createElement("h3");
    title.textContent = section.title;
    header.appendChild(title);
    if (section.description) {
      const desc = document.createElement("p");
      desc.textContent = section.description;
      header.appendChild(desc);
    }
    card.appendChild(header);

    section.fields.forEach((field) => {
      const fieldWrapper = document.createElement("div");
      fieldWrapper.className = "config-field";
      const pathString = pathArrayToString(field.path);
      const controlId = `config-field-${pathString.replace(/\./g, "-")}`;
      const isDefault = defaults.includes(pathString);

      if (field.type === "checkbox") {
        const checkboxRow = document.createElement("label");
        checkboxRow.className = "config-checkbox-row";
        const control = createFieldControl(field, pathString, controlId);
        checkboxRow.append(control);
        const labelText = document.createElement("span");
        labelText.textContent = field.label;
        checkboxRow.append(labelText);
        if (isDefault) {
          checkboxRow.append(createDefaultBadge());
        }
        fieldWrapper.appendChild(checkboxRow);
      } else {
        const labelRow = document.createElement("div");
        labelRow.className = "field-label-row";
        const labelText = document.createElement("span");
        labelText.textContent = field.label;
        labelRow.appendChild(labelText);
        if (isDefault) {
          labelRow.appendChild(createDefaultBadge());
        }
        fieldWrapper.appendChild(labelRow);
        const control = createFieldControl(field, pathString, controlId);
        fieldWrapper.appendChild(control);
      }

      if (field.helper) {
        const helper = document.createElement("div");
        helper.className = "field-helper";
        helper.textContent = field.helper;
        fieldWrapper.appendChild(helper);
      }

      card.appendChild(fieldWrapper);
    });

    if (typeof section.extra === "function") {
      const extraNode = section.extra(configState.snapshot);
      if (extraNode) {
        card.appendChild(extraNode);
      }
    }

    configCardsContainer.appendChild(card);
  });
}

function createQwenProviderNote(config) {
  const wrapper = document.createElement("div");
  wrapper.className = "config-sensitive-note";
  const provider = config?.models?.providers?.["qwen-portal"];
  const hasKey =
    typeof provider?.apiKey === "string" && provider.apiKey.trim().length > 0;
  wrapper.innerHTML = `<strong>qwen-portal / coder-model</strong><br/>
    ${hasKey ? "凭证已存在，API Key 由本地脚本维护，不会透传到浏览器。" : "未检测到 qwen API Key，需运行脚本生成后自动注入。"}<br/>
    <code>node scripts/qwen-oauth-login.ts</code>（或 <code>npm run qwen-auth</code>）`;
  return wrapper;
}

function updateMetaTooltip() {
  if (configMetaUpdated && configState.snapshot?.meta?.lastTouchedAt) {
    const touchedAt = new Date(configState.snapshot.meta.lastTouchedAt);
    configMetaUpdated.textContent = `最后保存：${touchedAt.toLocaleString()}`;
  }
  if (configMetaState) {
    configMetaState.textContent = configState.isLoading
      ? "缓存状态：加载中"
      : "缓存状态：同步完成";
  }
}

function updateDefaultStrip() {
  if (!configDefaultStripElement) return;
  const defaultCount = configState.metadata?.defaultPaths?.length || 0;
  configDefaultStripElement.innerHTML = defaultCount
    ? `当前有 <strong>${defaultCount}</strong> 个字段与系统默认值一致，清空后依旧会自动补齐。`
    : "当前所有字段均为自定义值（或尚未加载默认信息）。";
}

function renderConfigLoaded() {
  renderConfigCards();
  updateMetaTooltip();
  updateDefaultStrip();
  configState.patch = {};
  configState.dirtyPaths.clear();
  updateButtons();
}

async function loadConfig({ forceRefresh = false } = {}) {
  if (!configCardsContainer) return;
  configState.isLoading = true;
  updateButtons();
  clearToast();
  configCardsContainer.innerHTML = '<p class="muted">正在加载配置...</p>';
  const query = forceRefresh ? "?refresh=true" : "";
  try {
    const response = await fetch(`/api/config/fgbg${query}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "配置获取失败");
    }
    configState.snapshot = data.config;
    configState.metadata = data.metadata;
    configState.initialized = true;
    renderConfigLoaded();
  } catch (error) {
    configCardsContainer.innerHTML =
      '<p class="muted">配置加载失败，请重试。</p>';
    showToast(`加载失败：${error.message || error}`, "error");
  } finally {
    configState.isLoading = false;
    updateButtons();
  }
}

function ensureConfigLoaded(force = false) {
  if (!configState.initialized || force) {
    loadConfig({ forceRefresh: force });
  }
}

function updateButtons() {
  const hasDirty = configState.dirtyPaths.size > 0;
  if (configSaveBtn) {
    configSaveBtn.disabled = configState.isSaving || !hasDirty;
    configSaveBtn.textContent = configState.isSaving ? "保存中..." : "保存变更";
  }
  if (configRevertBtn) {
    configRevertBtn.disabled = configState.isSaving || !hasDirty;
  }
  if (configRefreshBtn) {
    configRefreshBtn.disabled = configState.isLoading || configState.isSaving;
  }
  if (configResetBtn) {
    configResetBtn.disabled = configState.isLoading || configState.isSaving;
  }
}

function clearToast() {
  if (!configToast) return;
  configToast.classList.add("hidden");
  configToast.classList.remove("success", "error");
  configToast.textContent = "";
  window.clearTimeout(toastTimer);
}

function showToast(message, type = "success") {
  if (!configToast) return;
  clearToast();
  configToast.classList.remove("hidden");
  configToast.classList.add(type === "error" ? "error" : "success");
  configToast.textContent = message;
  toastTimer = window.setTimeout(() => {
    configToast.classList.add("hidden");
  }, 4200);
}

async function handleSaveConfig() {
  if (!configState.dirtyPaths.size || configState.isSaving) return;
  configState.isSaving = true;
  updateButtons();
  clearToast();
  try {
    const response = await fetch("/api/config/fgbg", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configState.patch),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "保存接口返回异常");
    }
    configState.snapshot = data.config;
    configState.metadata = data.metadata;
    configState.initialized = true;
    renderConfigLoaded();
    showToast("配置保存成功", "success");
  } catch (error) {
    showToast(`保存失败：${error.message || error}`, "error");
  } finally {
    configState.isSaving = false;
    updateButtons();
  }
}

function handleRevertChanges() {
  configState.patch = {};
  configState.dirtyPaths.clear();
  renderConfigLoaded();
}

async function handleResetConfig() {
  const confirmReset = confirm(
    "恢复默认会重写当前配置并且无法撤销，是否继续？",
  );
  if (!confirmReset) return;
  configState.isSaving = true;
  updateButtons();
  clearToast();
  try {
    const response = await fetch("/api/config/fgbg/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "恢复默认失败");
    }
    configState.snapshot = data.config;
    configState.metadata = data.metadata;
    configState.initialized = true;
    renderConfigLoaded();
    showToast("恢复默认成功", "success");
  } catch (error) {
    showToast(`恢复默认失败：${error.message || error}`, "error");
  } finally {
    configState.isSaving = false;
    updateButtons();
  }
}

function handleRefreshConfig() {
  if (
    configState.dirtyPaths.size &&
    !confirm("存在未保存的变更，刷新将丢失它们，是否继续？")
  ) {
    return;
  }
  loadConfig({ forceRefresh: true });
}

function renderRoute() {
  const rawHash = window.location.hash || "#chat";
  const target =
    rawHash === "#config"
      ? "#config"
      : rawHash === "#scheduler"
        ? "#scheduler"
        : "#chat";

  // Update nav items active state
  navItems.forEach((nav) => {
    const route = nav.getAttribute("data-route") || "#chat";
    nav.classList.toggle("active", route === target);
  });

  // Update breadcrumb
  const viewName = viewNames[target] || "聊天";
  if (breadcrumbCurrent) {
    breadcrumbCurrent.textContent = viewName;
  }

  // Switch views
  switchView(target);

  // Load config if needed
  if (target === "#config") {
    ensureConfigLoaded();
  }
}

// Listen for hash changes
window.addEventListener("hashchange", renderRoute);
// Initial route render
renderRoute();

configRefreshBtn?.addEventListener("click", handleRefreshConfig);
configResetBtn?.addEventListener("click", handleResetConfig);
configSaveBtn?.addEventListener("click", handleSaveConfig);
configRevertBtn?.addEventListener("click", handleRevertChanges);

sendBtn.addEventListener("click", sendMessage);
clearBtn.addEventListener("click", clearHistory);
chatContainer.addEventListener(
  "scroll",
  (e) => {
    if (e.target === chatContainer) {
      refreshAutoScrollState();
    } else if (e.target.tagName === "PRE") {
      if (!isNearBottom(e.target)) {
        autoScrollEnabled = false;
        updateScrollBottomButtonVisibility();
      } else if (isNearBottom(chatContainer)) {
        autoScrollEnabled = true;
        updateScrollBottomButtonVisibility();
      }
    }
  },
  true,
);

chatContainer.addEventListener("click", async (e) => {
  if (e.target.classList.contains("msg-copy-btn")) {
    e.preventDefault();
    e.stopPropagation();
    const messageEl = e.target.closest(".message");
    let textToCopy = "";
    if (messageEl.classList.contains("assistant")) {
      const markdowns = messageEl.querySelectorAll(
        ".timeline-markdown:not(.user)",
      );
      textToCopy = Array.from(markdowns)
        .map((m) => m.dataset.markdown || m.textContent || "")
        .join("\n\n");
    } else {
      const userContent = messageEl.querySelector(".timeline-markdown.user");
      textToCopy = userContent ? userContent.textContent : "";
    }

    if (textToCopy) {
      const success = await copyToClipboard(textToCopy);
      if (success) {
        const originalText = e.target.textContent;
        e.target.textContent = "Copied";
        setTimeout(() => (e.target.textContent = originalText), 1200);
      }
    }
  }

  if (e.target.classList.contains("details-copy-btn")) {
    e.preventDefault();
    e.stopPropagation();
    const details = e.target.closest("details");
    const pre = details.querySelector("pre");
    if (pre && pre.textContent) {
      const success = await copyToClipboard(pre.textContent);
      if (success) {
        const originalText = e.target.textContent;
        e.target.textContent = "Copied";
        setTimeout(() => (e.target.textContent = originalText), 1200);
      }
    }
  }

  if (e.target.classList.contains("code-copy-btn")) {
    e.preventDefault();
    e.stopPropagation();
    const wrapper = e.target.closest(".code-block-wrapper");
    const code = wrapper.querySelector("code");
    if (code && code.textContent) {
      const success = await copyToClipboard(code.textContent);
      if (success) {
        const originalText = e.target.textContent;
        e.target.textContent = "Copied";
        setTimeout(() => (e.target.textContent = originalText), 1200);
      }
    }
  }
});
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

addMessage(
  "您好！我是您的 AI 助手。左侧将展示对话、工具调用和上下文变化时间线。",
  "assistant",
);
renderSchedulerList();
renderSchedulerDetail();
bindSchedulerActions();
initScrollBottomButton();
