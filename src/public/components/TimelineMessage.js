/**
 * TimelineMessage Component
 * Qwen Code style timeline message with status bullet and connector line
 */

/**
 * Create a timeline message container with status bullet and connector line
 * @param {string} type - 'thinking' | 'execute' | 'success' | 'error' | 'warning'
 * @param {string} label - Header label (e.g., "Thinking", "Execute")
 * @param {boolean} isLoading - Whether this is a loading state
 * @returns {HTMLDivElement}
 */
export function createTimelineMessage(type, label, isLoading = false) {
  const container = document.createElement("div");
  container.className = `timeline-message-container status-${type}${isLoading ? '-loading' : ''}`;

  const header = document.createElement("div");
  header.className = "timeline-message-header";

  const labelEl = document.createElement("span");
  labelEl.className = `timeline-message-label ${type}`;
  labelEl.textContent = label;

  header.appendChild(labelEl);
  container.appendChild(header);

  return container;
}

/**
 * Add content to a timeline message
 * @param {HTMLDivElement} container
 * @param {string} content
 * @param {boolean} isThinking - Whether this is thinking content (styled differently)
 */
export function addTimelineMessageContent(container, content, isThinking = false) {
  const contentEl = document.createElement("div");
  contentEl.className = `timeline-message-content${isThinking ? ' thinking-content' : ''}`;
  contentEl.innerHTML = renderMarkdown(content);
  container.appendChild(contentEl);
}

/**
 * Append a thinking message to the stream
 * @param {HTMLElement} messageEl
 * @param {string} content
 * @param {boolean} isLoading
 */
export function appendThinkingMessage(messageEl, content, isLoading = false) {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;

  const thinkingMsg = createTimelineMessage("thinking", "Thinking", isLoading);
  addTimelineMessageContent(thinkingMsg, content, true);
  stream.appendChild(thinkingMsg);
  scrollToBottom();
}

/**
 * Append an execute message to the stream
 * @param {HTMLElement} messageEl
 * @param {string} label - Execute label
 * @param {string} command - Command executed
 * @param {string} output - Command output
 * @param {string} status - 'success' | 'error' | 'loading'
 */
export function appendExecuteMessage(messageEl, label, command, output, status = "success") {
  const stream = getAssistantStream(messageEl);
  if (!stream) return;

  const executeMsg = createTimelineMessage("execute", label, status === "loading");
  if (status === "success") {
    executeMsg.classList.remove("status-execute-loading");
    executeMsg.classList.add("status-execute");
  }

  const toolCallCard = createToolCallCard(command, output);
  executeMsg.appendChild(toolCallCard);

  stream.appendChild(executeMsg);
  scrollToBottom();
}

// Helper functions (imported from main app)
function getAssistantStream(messageEl) {
  return messageEl?.querySelector(".timeline-stream");
}

function renderMarkdown(text) {
  if (text == null || typeof text !== "string") return "";
  const raw = window.md.render(text);
  return window.DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "u", "s", "a", "code", "pre",
      "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
      "hr", "table", "thead", "tbody", "tr", "th", "td", "span", "div", "button",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "class", "data-language"],
  });
}

function scrollToBottom(options = {}) {
  const { force = false } = options;
  if (!force && !window.autoScrollEnabled) return;
  window.chatContainer.scrollTop = window.chatContainer.scrollHeight;
}
