import React, { useMemo } from 'react';
import { marked } from 'marked';
import type { ChatMessage } from '../hooks/useChat';

interface Props { message: ChatMessage; }

// Configure marked for safe, synchronous rendering.
// The html renderer override strips raw HTML blocks emitted by the LLM so
// they cannot inject event-handler-based scripts (e.g. <img onerror=...>)
// that would bypass the webview's CSP nonce restriction on <script> tags.
marked.use({
  renderer: {
    // Return an empty string for raw HTML blocks — this removes literal HTML
    // that the LLM might emit while leaving all markdown syntax rendering intact.
    html(): string { return ''; },
  },
});
marked.setOptions({ async: false, breaks: true, gfm: true });

/**
 * Renders markdown content as HTML using `marked`.
 * Tool-call status lines get special styling.
 * Raw HTML emitted by the LLM is stripped to prevent XSS.
 */
function renderMarkdown(text: string): string {
  // Style tool-call status lines before markdown rendering
  const processed = text.replace(
    /^\[Calling \w[\w.]*\.\.\.\]$/gm,
    (match) => `<div class="tool-call">${match}</div>`,
  );
  return marked.parse(processed) as string;
}

export const MessageBubble: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';

  const html = useMemo(() => {
    if (isUser) return null;
    return renderMarkdown(message.content);
  }, [isUser, message.content]);

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '0.75rem',
      padding: '0 1rem',
    }}>
      <div
        className={isUser ? undefined : 'markdown-body'}
        style={{
          maxWidth: '85%',
          padding: '0.6rem 0.9rem',
          borderRadius: '8px',
          background: isUser
            ? 'var(--vscode-button-background)'
            : 'var(--vscode-editorWidget-background)',
          color: isUser
            ? 'var(--vscode-button-foreground)'
            : 'var(--vscode-editor-foreground)',
          whiteSpace: isUser ? 'pre-wrap' : undefined,
          wordBreak: 'break-word',
          fontSize: '0.9rem',
          lineHeight: '1.5',
        }}
      >
        {isUser
          ? message.content
          : <div dangerouslySetInnerHTML={{ __html: html! }} />
        }
        {message.isStreaming && <span style={{ opacity: 0.5 }}>▋</span>}
      </div>
    </div>
  );
};
