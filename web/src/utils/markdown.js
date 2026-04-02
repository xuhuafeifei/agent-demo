import markdownit from "markdown-it";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";

const md = markdownit({
  html: false,
  linkify: true,
  breaks: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      const highlighted = hljs.highlight(code, {
        language: lang,
        ignoreIllegals: true,
      }).value;
      return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
    }
    const highlighted = hljs.highlightAuto(code).value;
    return `<pre><code class="hljs">${highlighted}</code></pre>`;
  },
});

export function renderMarkdown(text) {
  const raw = md.render(text || "");
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "u", "s", "a",
      "code", "pre", "ul", "ol", "li", "blockquote",
      "h1", "h2", "h3", "h4", "h5", "h6", "hr",
      "table", "thead", "tbody", "tr", "th", "td", "span", "div",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "class"],
  });
}

export async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  }
}
