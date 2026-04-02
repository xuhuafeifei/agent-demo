/**
 * ToolCallCard Component
 * Displays tool call results with IN/OUT format
 */

/**
 * Create a tool call card with IN/OUT format
 * @param {string} command - The command executed
 * @param {string} output - The command output
 * @returns {HTMLDivElement}
 */
export function createToolCallCard(command, output) {
  const card = document.createElement("div");
  card.className = "toolcall-card";

  if (command) {
    const commandRow = document.createElement("div");
    commandRow.className = "toolcall-row";
    commandRow.innerHTML = `
      <span class="toolcall-label in">IN</span>
      <span class="toolcall-value">${escapeHtml(command)}</span>
    `;
    card.appendChild(commandRow);
  }

  if (output) {
    const outputRow = document.createElement("div");
    outputRow.className = "toolcall-row";
    outputRow.innerHTML = `
      <span class="toolcall-label out">OUT</span>
      <span class="toolcall-value">${escapeHtml(output)}</span>
    `;
    card.appendChild(outputRow);
  }

  return card;
}

/**
 * Create a collapsible details element
 * @param {string} summary - Summary text
 * @param {string} content - Detailed content
 * @param {boolean} open - Whether to be open by default
 * @returns {HTMLDetailsElement}
 */
export function createCollapsibleDetails(summary, content, open = false) {
  const details = document.createElement("details");
  details.className = "timeline-details";
  details.open = open;

  const summaryEl = document.createElement("summary");
  summaryEl.textContent = summary;
  details.appendChild(summaryEl);

  const pre = document.createElement("pre");
  pre.textContent = content;
  details.appendChild(pre);

  return details;
}

/**
 * Escape HTML special characters
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
