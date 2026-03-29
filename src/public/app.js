const chatContainer = document.getElementById("chat-container");
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
const chatPanel = document.querySelector(".chat-panel");
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

function updateScrollBottomButtonVisibility() {
  if (!scrollBottomBtn) return;
  scrollBottomBtn.classList.toggle("visible", !autoScrollEnabled);
}

function refreshAutoScrollState() {
  autoScrollEnabled = isNearBottom(chatContainer);
  updateScrollBottomButtonVisibility();
}

function initScrollBottomButton() {
  if (!chatPanel || scrollBottomBtn) return;
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
    updateScrollBottomButtonVisibility();
  });
  chatPanel.appendChild(btn);
  scrollBottomBtn = btn;
  updateScrollBottomButtonVisibility();
}

const md = window.markdownit({ html: false, linkify: true, breaks: true });
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
    ],
    ALLOWED_ATTR: ["href", "target", "rel"],
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
  if (["error", "auto_retry_start", "auto_retry_end", "compaction_start", "compaction_end"].includes(data.type)) {
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
    try {
      await navigator.clipboard.writeText(currentSnapshot || "");
      cvButton.textContent = "Copied";
      setTimeout(() => {
        cvButton.textContent = "CV";
      }, 1200);
    } catch (_err) {
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
          event.tokensBefore ? `压缩完成，压缩前 Token 数：${event.tokensBefore}` : "会话已压缩过，跳过本次压缩"
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

sendBtn.addEventListener("click", sendMessage);
clearBtn.addEventListener("click", clearHistory);
chatContainer.addEventListener("scroll", refreshAutoScrollState);
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
