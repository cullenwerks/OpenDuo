import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { marked } from 'marked';
import type { ChatMessage } from '../hooks/useChat';
import { sanitizeHtml } from '../sanitize';
import vscode from '../vscode';

interface Props { message: ChatMessage; }

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDiffLine(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return escapeHtml(line);
  if (line.startsWith('+')) return `<span class="diff-add">${escapeHtml(line)}</span>`;
  if (line.startsWith('-')) return `<span class="diff-remove">${escapeHtml(line)}</span>`;
  return escapeHtml(line);
}

marked.use({
  renderer: {
    html(): string { return ''; },
    code(token: { text: string; lang?: string }): string {
      const lang = token.lang || 'text';
      const raw = encodeURIComponent(token.text);
      const isDiff = lang === 'diff' || lang === 'patch';
      const body = isDiff
        ? token.text.split('\n').map(renderDiffLine).join('\n')
        : escapeHtml(token.text);
      return `<div class="code-block" data-lang="${lang}">
  <div class="code-header">
    <span class="code-lang">${escapeHtml(lang)}</span>
    <div class="code-actions">
      <button data-action="copy" data-raw="${raw}">Copy</button>
      <button data-action="open" data-raw="${raw}" data-lang="${escapeHtml(lang)}">Open</button>
    </div>
  </div>
  <pre><code class="language-${escapeHtml(lang)}">${body}</code></pre>
</div>`;
    },
  },
});
marked.setOptions({ async: false, breaks: true, gfm: true });

/**
 * Renders markdown content as HTML using `marked`.
 * Tool-call status lines get special styling.
 * Raw HTML emitted by the LLM is stripped to prevent XSS.
 */
function renderMarkdown(text: string): string {
  let html = marked.parse(text) as string;

  html = html.replace(
    /\[Calling (\w[\w.]*)\.\.\.\]/g,
    (_match, name) => `<div class="tool-call">[Calling ${sanitizeHtml(name)}...]</div>`,
  );
  return html;
}

export const MessageBubble: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';
  const containerRef = useRef<HTMLDivElement>(null);
  const [animating, setAnimating] = useState(true);

  const html = useMemo(() => {
    if (isUser) return null;
    return renderMarkdown(message.content);
  }, [isUser, message.content]);

  const handleClick = useCallback((e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const raw = target.dataset.raw;
    if (!raw) return;
    const decoded = decodeURIComponent(raw);
    if (action === 'copy') {
      navigator.clipboard.writeText(decoded).catch(() => {});
      const orig = target.textContent ?? 'Copy';
      target.textContent = 'Copied';
      setTimeout(() => { target.textContent = orig; }, 1500);
    } else if (action === 'open') {
      const lang = target.dataset.lang ?? 'plaintext';
      vscode.postMessage({ type: 'openCode', code: decoded, language: lang });
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('click', handleClick as EventListener);
    return () => el.removeEventListener('click', handleClick as EventListener);
  }, [handleClick]);

  const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: isUser ? 'flex-end' : 'flex-start',
    marginBottom: '16px',
    padding: '0 12px',
  };

  if (isUser) {
    return (
      <div
        className={animating ? 'message-enter' : undefined}
        onAnimationEnd={() => setAnimating(false)}
        style={wrapperStyle}
      >
        <div style={{
          maxWidth: '78%',
          padding: '0.6rem 0.9rem',
          borderRadius: '18px',
          background: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: '0.9rem',
          lineHeight: '1.5',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}>
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className={animating ? 'message-enter' : undefined}
      onAnimationEnd={() => setAnimating(false)}
      style={wrapperStyle}
    >
      <div
        ref={containerRef}
        className="markdown-body"
        style={{
          width: '100%',
          borderLeft: '2px solid var(--vscode-button-background)',
          paddingLeft: '10px',
          fontSize: '0.9rem',
          lineHeight: '1.5',
          wordBreak: 'break-word',
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: html! }} />
        <span className={`streaming-cursor${message.isStreaming ? '' : ' done'}`} />
      </div>
    </div>
  );
};
