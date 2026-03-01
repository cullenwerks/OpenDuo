import React, { useMemo } from 'react';
import { marked } from 'marked';
import type { ChatMessage } from '../hooks/useChat';

interface Props { message: ChatMessage; }

/** Regex to detect tool-call status lines like "[Calling list_issues...]" */
const TOOL_CALL_RE = /^\[Calling \w+\.\.\.\]$/;

// Configure marked for safe, synchronous rendering
marked.setOptions({ async: false, breaks: true, gfm: true });

/**
 * Renders markdown content as HTML using `marked`.
 * Tool-call status lines get special styling.
 */
function renderMarkdown(text: string): string {
  // Process tool-call lines before markdown rendering
  const processed = text.replace(
    /^\[Calling \w+\.\.\.\]$/gm,
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
