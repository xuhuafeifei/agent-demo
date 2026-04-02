const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const navItems = Array.from(document.querySelectorAll(".nav-item"));
const chatThread = document.getElementById("chat-thread");
const chatScroll = document.getElementById("chat-scroll");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

const SIDEBAR_STORAGE_KEY = "agent_demo_sidebar_collapsed";
const COLLAPSE_BREAKPOINT = 1024;

const md = window.markdownit({
  html: false,
  linkify: true,
  breaks: true,
  highlight(str, lang) {
    if (lang && window.hljs?.getLanguage(lang)) {
      try {
        const highlighted = window.hljs.highlight(str, {
          language: lang,
          ignoreIllegals: true,
        }).value;
        return `<pre><code class=\"hljs language-${lang}\">${highlighted}</code></pre>`;
      } catch (_error) {
        // fallback to escaped plain text below
      }
    }
    return `<pre><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

const streamState = {
  assistantEl: null,
  assistantText: "",
  thinkingNode: null,
  thinkingText: "",
  toolCalls: new Map(),
  isStreaming: false,
};

let tooltipNode = null;
let tooltipTimer = 0;

function renderMarkdown(text) {
  const raw = md.render(text || "");
  return window.DOMPurify.sanitize(raw, {
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
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "class"],
  });
}

async function copyText(text) {
  if (!text) return false;
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_error) {
    // fallback below
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch (_error) {
    return false;
  }
}

function setEmptyState() {
  if (!chatThread) return;
  if (chatThread.childElementCount > 0) return;
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  wrapper.id = "empty-state";
  wrapper.innerHTML = `
    <div class="empty-card">
      <div class="empty-icon">💬</div>
      <p>开始新的对话吧</p>
      <p>输入问题或 @ 引用内容</p>
    </div>
  `;
  chatThread.appendChild(wrapper);
}

function clearEmptyState() {
  const node = document.getElementById("empty-state");
  if (node) node.remove();
}

function scrollToBottom(force = false) {
  if (!chatScroll) return;
  const nearBottom =
    chatScroll.scrollHeight - (chatScroll.scrollTop + chatScroll.clientHeight) <
    48;
  if (force || nearBottom) {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }
}

function createMessageNode(role) {
  const message = document.createElement("article");
  message.className = `message message-${role}`;
  return message;
}

function addUserMessage(text) {
  clearEmptyState();
  const message = createMessageNode("user");
  const bubble = document.createElement("div");
  bubble.className = "user-bubble";
  bubble.textContent = text;
  message.appendChild(bubble);
  chatThread.appendChild(message);
  scrollToBottom(true);
}

function createCopyButton(contentProvider) {
  const container = document.createElement("div");
  container.className = "copy-button-container";

  const btn = document.createElement("button");
  btn.className = "copy-button";
  btn.type = "button";
  btn.setAttribute("aria-label", "复制内容");
  btn.textContent = "📋";

  btn.addEventListener("click", async () => {
    const ok = await copyText(contentProvider());
    if (!ok) return;
    btn.classList.add("copied");
    btn.textContent = "✓";
    window.setTimeout(() => {
      btn.classList.remove("copied");
      btn.textContent = "📋";
    }, 2000);
  });

  container.appendChild(btn);
  return container;
}

function createAssistantMessage() {
  clearEmptyState();
  const message = createMessageNode("assistant");
  const response = document.createElement("div");
  response.className = "llm-response";

  const content = document.createElement("div");
  content.className = "llm-response-content streaming-cursor";

  response.appendChild(content);
  response.appendChild(createCopyButton(() => streamState.assistantText));
  message.appendChild(response);
  chatThread.appendChild(message);
  scrollToBottom(true);

  return { message, content };
}

function updateAssistantMessage(contentEl, text, done = false) {
  streamState.assistantText = text;
  contentEl.innerHTML = renderMarkdown(text);
  contentEl.classList.toggle("streaming-cursor", !done);
  scrollToBottom();
}

function ensureThinkingNode() {
  if (streamState.thinkingNode) return streamState.thinkingNode;

  const wrapper = document.createElement("section");
  wrapper.className = "thinking-message";

  const toggle = document.createElement("button");
  toggle.className = "thinking-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = `<span>Thinking</span><span>⌄</span>`;

  const content = document.createElement("div");
  content.className = "thinking-content";
  content.id = `thinking-${Date.now()}`;

  toggle.setAttribute("aria-controls", content.id);
  toggle.addEventListener("click", () => {
    const expanded = content.style.display === "block";
    content.style.display = expanded ? "none" : "block";
    toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    toggle.innerHTML = `<span>Thinking</span><span>${expanded ? "⌄" : "⌃"}</span>`;
  });

  wrapper.appendChild(toggle);
  wrapper.appendChild(content);

  chatThread.appendChild(wrapper);
  streamState.thinkingNode = { wrapper, content };
  return streamState.thinkingNode;
}

function appendThinkingChunk(chunk) {
  const node = ensureThinkingNode();
  streamState.thinkingText += chunk || "";
  node.content.style.display = "block";
  node.content.innerHTML = renderMarkdown(streamState.thinkingText);
  scrollToBottom();
}

function createToolCard(toolCall) {
  const wrapper = document.createElement("section");
  wrapper.className = "tool-call-card status-running";

  const content = document.createElement("div");
  content.className = "tool-call-content";

  const title = document.createElement("div");
  title.className = "tool-call-title";
  title.textContent = toolCall.title || "工具调用";

  const path = document.createElement("div");
  path.className = "tool-call-path";
  path.textContent = toolCall.content || toolCall.toolName || "-";

  const status = document.createElement("div");
  status.className = "tool-call-status";
  status.textContent = "进行中...";

  content.appendChild(title);
  content.appendChild(path);
  content.appendChild(status);
  wrapper.appendChild(content);
  chatThread.appendChild(wrapper);

  return { wrapper, title, path, status };
}

function upsertToolCall(payload) {
  const id = payload.id || payload.toolCallId;
  if (!id) return;

  if (!streamState.toolCalls.has(id)) {
    const created = createToolCard({
      title: payload.title || `正在执行 ${payload.toolName || "工具"}`,
      content:
        payload.content ||
        (payload.args != null ? JSON.stringify(payload.args) : payload.toolName || ""),
      toolName: payload.toolName,
    });
    streamState.toolCalls.set(id, created);
  }

  const node = streamState.toolCalls.get(id);
  const status = payload.status || "running";
  node.wrapper.classList.remove("status-running", "status-completed", "status-error");

  if (status === "completed") {
    node.wrapper.classList.add("status-completed");
    node.status.textContent = payload.detail || "完成";
  } else if (status === "error") {
    node.wrapper.classList.add("status-error");
    node.status.textContent = payload.detail || "执行失败";
  } else {
    node.wrapper.classList.add("status-running");
    node.status.textContent = payload.detail || "进行中...";
  }

  if (payload.title) node.title.textContent = payload.title;
  if (payload.content) node.path.textContent = payload.content;
  scrollToBottom();
}

function handleStreamEvent(type, payload) {
  if (!payload || typeof payload !== "object") return;

  switch (type || payload.type) {
    case "streamStart": {
      streamState.isStreaming = true;
      streamState.assistantText = "";
      streamState.thinkingText = "";
      streamState.thinkingNode = null;
      streamState.toolCalls.clear();
      const { message, content } = createAssistantMessage();
      streamState.assistantEl = { message, content };
      break;
    }
    case "user_message_chunk": {
      break;
    }
    case "agent_message_chunk": {
      if (!streamState.assistantEl) {
        const { message, content } = createAssistantMessage();
        streamState.assistantEl = { message, content };
      }
      const chunk =
        typeof payload.content === "string"
          ? payload.content
          : typeof payload.delta === "string"
            ? payload.delta
            : "";
      streamState.assistantText += chunk;
      updateAssistantMessage(streamState.assistantEl.content, streamState.assistantText);
      break;
    }
    case "agent_thought_chunk": {
      const chunk =
        typeof payload.content === "string"
          ? payload.content
          : typeof payload.thinkingDelta === "string"
            ? payload.thinkingDelta
            : "";
      if (chunk) appendThinkingChunk(chunk);
      break;
    }
    case "tool_call": {
      upsertToolCall({
        id: payload.id,
        toolCallId: payload.toolCallId,
        title: payload.title,
        toolName: payload.toolName,
        content: payload.content,
        args: payload.args,
        status: "running",
      });
      break;
    }
    case "tool_call_update": {
      upsertToolCall({
        id: payload.id,
        toolCallId: payload.toolCallId,
        status: payload.status,
        detail: payload.detail,
        title: payload.title,
        content: payload.content,
      });
      break;
    }
    case "plan": {
      break;
    }
    case "streamEnd": {
      streamState.isStreaming = false;
      if (streamState.assistantEl) {
        updateAssistantMessage(
          streamState.assistantEl.content,
          streamState.assistantText,
          true,
        );
      }
      break;
    }
    case "error": {
      if (!streamState.assistantEl) {
        const { message, content } = createAssistantMessage();
        streamState.assistantEl = { message, content };
      }
      streamState.assistantText += `\n\n错误：${payload.error || "未知错误"}`;
      updateAssistantMessage(streamState.assistantEl.content, streamState.assistantText, true);
      break;
    }
    default:
      break;
  }
}

function parseSseBlocks(rawBuffer, onEvent) {
  const blocks = rawBuffer.split("\n\n");
  const rest = blocks.pop() || "";
  blocks.forEach((block) => {
    if (!block.trim()) return;
    const lines = block.split("\n");
    let eventType = "";
    const dataLines = [];
    lines.forEach((line) => {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    });
    if (!dataLines.length) return;
    const dataStr = dataLines.join("\n");
    try {
      const payload = JSON.parse(dataStr);
      onEvent(eventType || payload.type, payload);
    } catch (_error) {
      // keep streaming even with malformed events
    }
  });
  return rest;
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || streamState.isStreaming) return;

  addUserMessage(text);
  messageInput.value = "";
  adjustTextareaHeight();
  syncSendButtonState();
  sendBtn.disabled = true;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseBlocks(buffer, handleStreamEvent);
    }

    if (buffer.trim()) {
      parseSseBlocks(`${buffer}\n\n`, handleStreamEvent);
    }
  } catch (error) {
    handleStreamEvent("error", { error: String(error?.message || error) });
  } finally {
    handleStreamEvent("streamEnd", { type: "streamEnd" });
    sendBtn.disabled = false;
    messageInput.focus();
    syncSendButtonState();
  }
}

function adjustTextareaHeight() {
  messageInput.style.height = "auto";
  const h = Math.min(messageInput.scrollHeight, 200);
  messageInput.style.height = `${h}px`;
}

function syncSendButtonState() {
  const hasText = Boolean(messageInput.value.trim());
  sendBtn.classList.toggle("send-button-active", hasText && !sendBtn.disabled);
  sendBtn.classList.toggle("send-button-disabled", !hasText || sendBtn.disabled);
}

function setSidebarCollapsed(collapsed, { persist = true } = {}) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  if (persist) {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
  }
}

function applyResponsiveSidebar() {
  const small = window.innerWidth < COLLAPSE_BREAKPOINT;
  if (small) {
    setSidebarCollapsed(true, { persist: false });
  } else {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
    setSidebarCollapsed(saved, { persist: false });
  }
}

function ensureTooltip() {
  if (tooltipNode) return tooltipNode;
  tooltipNode = document.createElement("div");
  tooltipNode.className = "tooltip";
  document.body.appendChild(tooltipNode);
  return tooltipNode;
}

function showTooltip(target, text) {
  const tooltip = ensureTooltip();
  tooltip.textContent = text;
  const rect = target.getBoundingClientRect();
  tooltip.style.left = `${rect.right + 8}px`;
  tooltip.style.top = `${rect.top + rect.height / 2 - 16}px`;
  tooltip.classList.add("show");
}

function hideTooltip() {
  if (tooltipNode) tooltipNode.classList.remove("show");
}

function bindSidebarTooltip() {
  navItems.forEach((item) => {
    item.addEventListener("mouseenter", () => {
      if (!document.body.classList.contains("sidebar-collapsed")) return;
      const label = item.dataset.label || "";
      clearTimeout(tooltipTimer);
      tooltipTimer = window.setTimeout(() => showTooltip(item, label), 200);
    });
    item.addEventListener("mouseleave", () => {
      clearTimeout(tooltipTimer);
      hideTooltip();
    });
  });
}

function bindNavSelection() {
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      navItems.forEach((n) => n.classList.remove("nav-item-active"));
      item.classList.add("nav-item-active");
    });
  });
}

function bindInputActions() {
  messageInput.addEventListener("input", () => {
    adjustTextareaHeight();
    syncSendButtonState();
  });

  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!sendBtn.disabled && messageInput.value.trim()) {
        void sendMessage();
      }
    }
  });

  sendBtn.addEventListener("click", () => {
    if (!sendBtn.disabled && messageInput.value.trim()) {
      void sendMessage();
    }
  });
}

function bindGlobalActions() {
  sidebarToggle?.addEventListener("click", () => {
    const next = !document.body.classList.contains("sidebar-collapsed");
    setSidebarCollapsed(next, { persist: true });
  });

  window.addEventListener("resize", applyResponsiveSidebar);
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      messageInput.focus();
    }
    if (event.key === "Escape") {
      hideTooltip();
    }
  });
}

function bootstrap() {
  setEmptyState();
  bindSidebarTooltip();
  bindNavSelection();
  bindInputActions();
  bindGlobalActions();
  applyResponsiveSidebar();
  syncSendButtonState();
  messageInput.focus();
}

bootstrap();
