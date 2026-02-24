import React from 'react';
import type { ChatMessage } from '../hooks/useChat';

interface Props { message: ChatMessage; }

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
        maxWidth: '80%',
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
        {message.content}
        {message.isStreaming && <span style={{ opacity: 0.5 }}>▋</span>}
      </div>
    </div>
  );
};
