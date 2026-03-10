const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-btn');
const clearToolLogBtn = document.getElementById('clear-tool-log-btn');
const toolLogList = document.getElementById('tool-log-list');
const retryBanner = document.getElementById('retry-banner');

// 自动调整输入框高度
messageInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

// 发送消息
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    sendBtn.disabled = true;
    messageInput.disabled = true;

    addMessage(message, 'user');
    messageInput.value = '';
    messageInput.style.height = 'auto';

    const assistantMessageId = `msg-${Date.now()}`;
    addMessage('', 'assistant', assistantMessageId, true);
    if (retryBanner) retryBanner.textContent = '';
    const streamState = {
        fullText: '',
        displayedText: '',
        fullThinking: '',
        frameId: null,
        llmStartedAt: 0,
        llmEndedAt: 0,
    };

    const pumpStream = () => {
        if (streamState.displayedText.length >= streamState.fullText.length) {
            streamState.frameId = null;
            return;
        }
        const remain = streamState.fullText.length - streamState.displayedText.length;
        const step = Math.max(1, Math.ceil(remain / 24));
        streamState.displayedText += streamState.fullText.slice(
            streamState.displayedText.length,
            streamState.displayedText.length + step,
        );
        updateMessage(assistantMessageId, streamState.displayedText, true);
        streamState.frameId = requestAnimationFrame(pumpStream);
    };

    const schedulePump = () => {
        if (streamState.frameId !== null) return;
        streamState.frameId = requestAnimationFrame(pumpStream);
    };

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop();

            for (const event of events) {
                if (!event.startsWith('data: ')) continue;
                let data;
                try {
                    data = JSON.parse(event.slice(6));
                } catch (e) {
                    continue;
                }

                switch (data.type) {
                    case 'message_start':
                        if (data.message && data.message.errorMessage) {
                            updateMessage(assistantMessageId, '错误：' + data.message.errorMessage);
                            removeStreamingIndicator(assistantMessageId);
                        } else {
                            streamState.llmStartedAt = performance.now();
                        }
                        break;
                    case 'message_update':
                        if (typeof data.delta === 'string' && data.delta) {
                            streamState.fullText += data.delta;
                            schedulePump();
                        } else if (typeof data.text === 'string') {
                            streamState.fullText = data.text;
                            schedulePump();
                        } else {
                            streamState.fullText = getMessageContent(data.message || {});
                            schedulePump();
                        }
                        break;
                    case 'message_end':
                        if (data.message && data.message.errorMessage) {
                            streamState.fullText = '错误：' + data.message.errorMessage;
                        } else if (typeof data.text === 'string' && data.text) {
                            streamState.fullText = data.text;
                        } else {
                            streamState.fullText = getMessageContent(data.message || {});
                        }
                        streamState.displayedText = streamState.fullText;
                        updateMessage(assistantMessageId, streamState.displayedText, true);
                        streamState.llmEndedAt = performance.now();
                        removeStreamingIndicator(assistantMessageId);
                        appendTimestamp(
                            assistantMessageId,
                            streamState.llmStartedAt && streamState.llmEndedAt
                                ? Math.max(0, streamState.llmEndedAt - streamState.llmStartedAt)
                                : undefined,
                        );
                        break;
                    case 'thinking_update':
                        if (typeof data.thinkingDelta === 'string') {
                            streamState.fullThinking += data.thinkingDelta;
                        }
                        if (typeof data.thinking === 'string') {
                            streamState.fullThinking = data.thinking;
                        }
                        updateThinkingBlock(assistantMessageId, streamState.fullThinking);
                        break;
                    case 'auto_retry_start':
                        if (retryBanner && data.attempt != null && data.maxAttempts != null) {
                            const msg = data.errorMessage || '未知原因';
                            retryBanner.textContent = `正在重试 (${data.attempt}/${data.maxAttempts})，${data.delayMs ? data.delayMs / 1000 + 's 后重试。' : ''} 原因：${msg}`;
                        }
                        break;
                    case 'auto_retry_end':
                        if (retryBanner) {
                            retryBanner.textContent = data.success
                                ? ''
                                : `重试结束，未成功。${data.finalError ? ' 原因：' + data.finalError : ''}`;
                        }
                        break;
                    case 'tool_execution_start':
                        addToolLog(`${data.toolName || 'unknown'} 开始`, 'running', data.args);
                        break;
                    case 'tool_execution_update':
                        addToolLog(
                            `${data.toolName || 'unknown'} 更新`,
                            'running',
                            data.partialResult,
                        );
                        break;
                    case 'tool_execution_end':
                        addToolLog(
                            `${data.toolName || 'unknown'} ${data.isError ? '失败' : '完成'}`,
                            data.isError ? 'error' : 'ok',
                            data.result,
                        );
                        break;
                    case 'error':
                        if (retryBanner) retryBanner.textContent = '';
                        updateMessage(assistantMessageId, '错误：' + data.error);
                        if (!streamState.llmEndedAt && streamState.llmStartedAt) {
                            streamState.llmEndedAt = performance.now();
                        }
                        removeStreamingIndicator(assistantMessageId);
                        appendTimestamp(
                            assistantMessageId,
                            streamState.llmStartedAt && streamState.llmEndedAt
                                ? Math.max(0, streamState.llmEndedAt - streamState.llmStartedAt)
                                : undefined,
                        );
                        break;
                    case 'done':
                        if (retryBanner) retryBanner.textContent = '';
                        if (!streamState.llmEndedAt && streamState.llmStartedAt) {
                            streamState.llmEndedAt = performance.now();
                        }
                        removeStreamingIndicator(assistantMessageId);
                        appendTimestamp(
                            assistantMessageId,
                            streamState.llmStartedAt && streamState.llmEndedAt
                                ? Math.max(0, streamState.llmEndedAt - streamState.llmStartedAt)
                                : undefined,
                        );
                        break;
                }
            }
        }
    } catch (error) {
        console.error('发送消息失败:', error);
        updateMessage(assistantMessageId, '错误：' + error.message);
    } finally {
        sendBtn.disabled = false;
        messageInput.disabled = false;
        messageInput.focus();
    }
}

const md = window.markdownit({ html: false, linkify: true, breaks: true });

function renderMarkdown(text) {
    if (text == null || typeof text !== 'string') return '';
    const raw = md.render(text);
    return DOMPurify.sanitize(raw, {
        ALLOWED_TAGS: [
            'p', 'br', 'strong', 'em', 'u', 's', 'a', 'code', 'pre', 'ul', 'ol', 'li',
            'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead',
            'tbody', 'tr', 'th', 'td',
        ],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
    });
}

function getMessageContent(message) {
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
        return message.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join('');
    }
    return '';
}

function addMessage(content, role, id = `msg-${Date.now()}`, isStreaming = false) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${role}`;
    messageElement.id = id;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? 'U' : 'A';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    if (content) {
        contentDiv.innerHTML = renderMarkdown(content);
    }

    if (isStreaming && role === 'assistant') {
        const indicator = document.createElement('span');
        indicator.className = 'streaming-indicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';
        contentDiv.appendChild(indicator);
        contentDiv.classList.add('is-streaming');
    }

    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
    });
    if (!isStreaming) {
        contentDiv.appendChild(timestamp);
    }

    messageElement.appendChild(avatar);
    if (isStreaming && role === 'assistant') {
        const mainCol = document.createElement('div');
        mainCol.className = 'message-main';
        const thinkingBlock = document.createElement('div');
        thinkingBlock.className = 'thinking-block';
        thinkingBlock.setAttribute('data-thinking', '');
        mainCol.appendChild(thinkingBlock);
        mainCol.appendChild(contentDiv);
        messageElement.appendChild(mainCol);
    } else {
        messageElement.appendChild(contentDiv);
    }

    chatContainer.appendChild(messageElement);
    scrollToBottom();
    return messageElement;
}

function updateThinkingBlock(id, thinking) {
    const messageEl = document.getElementById(id);
    const block = messageEl ? messageEl.querySelector('.thinking-block') : null;
    if (block) {
        block.innerHTML = renderMarkdown(thinking);
        block.style.display = thinking ? 'block' : 'none';
    }
}

function updateMessage(id, content, keepStreaming = false) {
    const messageEl = document.getElementById(id);
    const contentDiv = messageEl ? messageEl.querySelector('.content') : null;
    if (contentDiv) {
        const timestamp = contentDiv.querySelector('.timestamp');
        const metrics = contentDiv.querySelector('.llm-metrics');
        const indicator = keepStreaming ? contentDiv.querySelector('.streaming-indicator') : null;
        contentDiv.innerHTML = renderMarkdown(content);
        if (timestamp) contentDiv.appendChild(timestamp);
        if (metrics) contentDiv.appendChild(metrics);
        if (indicator) contentDiv.appendChild(indicator);
    }
    scrollToBottom();
}

function appendMessageContent(id, delta) {
    const messageEl = document.getElementById(id);
    const contentDiv = messageEl ? messageEl.querySelector('.content') : null;
    if (contentDiv) {
        const timestamp = contentDiv.querySelector('.timestamp');
        const indicator = contentDiv.querySelector('.streaming-indicator');
        if (indicator) indicator.remove();
        const textNode =
            contentDiv.childNodes.length && contentDiv.lastChild.nodeType === Node.TEXT_NODE
                ? contentDiv.lastChild
                : null;
        if (textNode) {
            textNode.textContent += delta;
        } else {
            contentDiv.appendChild(document.createTextNode(delta));
        }
        if (timestamp) contentDiv.appendChild(timestamp);
    }
    scrollToBottom();
}

function removeStreamingIndicator(id) {
    const messageEl = document.getElementById(id);
    const contentDiv = messageEl ? messageEl.querySelector('.content') : null;
    if (contentDiv) {
        const indicator = contentDiv.querySelector('.streaming-indicator');
        if (indicator) indicator.remove();
        contentDiv.classList.remove('is-streaming');
    }
}

function appendTimestamp(id, llmElapsedMs) {
    const messageEl = document.getElementById(id);
    const contentDiv = messageEl ? messageEl.querySelector('.content') : null;
    if (contentDiv && !contentDiv.querySelector('.timestamp')) {
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'timestamp';
        timestampDiv.textContent = new Date().toLocaleTimeString('zh-CN');
        contentDiv.appendChild(timestampDiv);
    }
    if (contentDiv) {
        const oldMetrics = contentDiv.querySelector('.llm-metrics');
        if (oldMetrics) oldMetrics.remove();
        if (typeof llmElapsedMs === 'number') {
            const metricsDiv = document.createElement('div');
            metricsDiv.className = 'timestamp llm-metrics';
            metricsDiv.textContent = `LLM耗时 ${formatDuration(llmElapsedMs)}`;
            contentDiv.appendChild(metricsDiv);
        }
    }
}

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '0ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function formatToolPayload(payload) {
    if (payload === null || payload === undefined) return '';
    try {
        const text = JSON.stringify(payload);
        if (text.length <= 180) return text;
        return text.slice(0, 180) + '...';
    } catch (_e) {
        return String(payload);
    }
}

function addToolLog(title, status = 'running', payload) {
    if (!toolLogList) return;
    const item = document.createElement('li');
    item.className = 'tool-log-item';
    const now = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    let statusText = '[进行中]';
    let statusClass = '';
    if (status === 'ok') {
        statusText = '[成功]';
        statusClass = 'tool-status-ok';
    } else if (status === 'error') {
        statusText = '[失败]';
        statusClass = 'tool-status-error';
    }
    const payloadText = formatToolPayload(payload);
    item.innerHTML = `<span>${now}</span> <span class="${statusClass}">${statusText}</span> <span>${title}${payloadText ? ' · ' + payloadText : ''}</span>`;
    toolLogList.prepend(item);
    while (toolLogList.childElementCount > 50) {
        toolLogList.removeChild(toolLogList.lastElementChild);
    }
}

function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function clearHistory() {
    if (!confirm('确定要清除所有聊天历史吗？')) return;
    try {
        const response = await fetch('/api/clear', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            const welcomeMessage = chatContainer.firstChild;
            chatContainer.innerHTML = '';
            chatContainer.appendChild(welcomeMessage);
        } else {
            addMessage('清除历史失败：' + data.error, 'assistant');
        }
    } catch (error) {
        addMessage('网络错误：无法清除历史', 'assistant');
    }
}

sendBtn.addEventListener('click', sendMessage);
clearBtn.addEventListener('click', clearHistory);
clearToolLogBtn.addEventListener('click', () => {
    toolLogList.innerHTML = '';
});
messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
});
