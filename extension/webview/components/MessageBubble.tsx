import React from 'react';
import type { ChatMessage } from '../hooks/useChat';

interface Props { message: ChatMessage; }

/** Regex to detect tool-call status lines like "[Calling list_issues...]" */
const TOOL_CALL_RE = /^\[Calling \w+\.\.\.\]$/;

/**
 * Renders message content with basic formatting:
 * - Fenced code blocks (```lang ... ```)
 * - Inline code (`code`)
 * - Tool call lines get distinct styling
 */
function renderContent(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Split on fenced code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('```') && part.endsWith('```')) {
      // Fenced code block
      const inner = part.slice(3, -3);
      // Strip optional language identifier on first line
      const newlineIdx = inner.indexOf('\n');
      const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
      const lang = newlineIdx >= 0 ? inner.slice(0, newlineIdx).trim() : '';
      nodes.push(
        <div key={`code-${i}`} style={{ position: 'relative', margin: '0.5rem 0' }}>
          {lang && (
            <div style={{
              fontSize: '0.7rem',
              opacity: 0.5,
              padding: '0.2rem 0.5rem',
              background: 'var(--vscode-editor-background)',
              borderRadius: '4px 4px 0 0',
              borderBottom: 'none',
            }}>
              {lang}
            </div>
          )}
          <pre style={{
            background: 'var(--vscode-editor-background)',
            padding: '0.5rem',
            borderRadius: lang ? '0 0 4px 4px' : '4px',
            overflowX: 'auto',
            fontSize: '0.8rem',
            lineHeight: '1.4',
            margin: 0,
          }}>
            <code>{code}</code>
          </pre>
        </div>
      );
    } else {
      // Regular text — process line by line for tool calls, and inline code
      const lines = part.split('\n');
      for (let j = 0; j < lines.length; j++) {
        const line = lines[j];
        if (TOOL_CALL_RE.test(line.trim())) {
          // Tool call notification — render with distinct styling
          nodes.push(
            <div key={`tool-${i}-${j}`} style={{
              fontSize: '0.8rem',
              opacity: 0.7,
              fontStyle: 'italic',
              padding: '0.2rem 0',
              borderLeft: '2px solid var(--vscode-button-background, #007acc)',
              paddingLeft: '0.5rem',
              margin: '0.25rem 0',
            }}>
              {line.trim()}
            </div>
          );
        } else {
          // Process inline code within this line
          nodes.push(
            <React.Fragment key={`line-${i}-${j}`}>
              {j > 0 && '\n'}
              {renderInlineCode(line)}
            </React.Fragment>
          );
        }
      }
    }
  }
  return nodes;
}

/** Renders inline `code` spans within a text line. */
function renderInlineCode(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} style={{
          background: 'var(--vscode-editor-background)',
          padding: '0.1rem 0.3rem',
          borderRadius: '3px',
          fontSize: '0.85em',
        }}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export const MessageBubble: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '0.75rem',
      padding: '0 1rem',
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '0.6rem 0.9rem',
        borderRadius: '8px',
        background: isUser
          ? 'var(--vscode-button-background)'
          : 'var(--vscode-editorWidget-background)',
        color: isUser
          ? 'var(--vscode-button-foreground)'
          : 'var(--vscode-editor-foreground)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: '0.9rem',
        lineHeight: '1.5',
      }}>
        {isUser ? message.content : renderContent(message.content)}
        {message.isStreaming && <span style={{ opacity: 0.5 }}>▋</span>}
      </div>
    </div>
  );
};
