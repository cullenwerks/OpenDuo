import React, { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { ToolStatusArea } from './ToolCallRow';
import type { ChatMessage, PendingConfirmation, ToolCallEntry } from '../hooks/useChat';

const EXAMPLE_PROMPTS = [
  'List my open merge requests',
  'Show the last 5 failed pipelines',
  'Search for issues labeled "bug" in my project',
  'What CI/CD variables are set?',
  'Find all repos in our group that use lodash',
  'Show open MRs across the group that touch auth/',
  'Who has the most open issues in our group?',
];

interface Props {
  messages: ChatMessage[];
  isLoading?: boolean;
  onExampleClick?: (text: string) => void;
  pendingConfirmation?: PendingConfirmation | null;
  onConfirm?: (id: string, approved: boolean) => void;
  toolCalls?: ToolCallEntry[];
}

export const ChatWindow: React.FC<Props> = ({ messages, isLoading, onExampleClick, pendingConfirmation, onConfirm, toolCalls }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Use instant scroll while a response is streaming (fires on every token)
    // so we don't stack up hundreds of competing smooth-scroll animations.
    // Switch to smooth only when a new discrete message arrives.
    const lastMsg = messages[messages.length - 1];
    const behavior = lastMsg?.isStreaming ? 'auto' : 'smooth';
    bottomRef.current?.scrollIntoView({ behavior });
  }, [messages]);

  const lastMessage = messages[messages.length - 1];
  const showThinking = isLoading && lastMessage?.role === 'assistant' && lastMessage.content === '';

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '1rem 0',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {messages.length === 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          padding: '2rem',
          gap: '1.5rem',
        }}>
          <div style={{ fontSize: '1.1rem', opacity: 0.6 }}>
            Ask me anything about your GitLab projects
          </div>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            justifyContent: 'center',
            maxWidth: '500px',
          }}>
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => onExampleClick?.(prompt)}
                style={{
                  background: 'var(--vscode-editorWidget-background)',
                  color: 'var(--vscode-editor-foreground)',
                  border: '1px solid var(--vscode-panel-border)',
                  borderRadius: '6px',
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}
      {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
      {toolCalls && toolCalls.length > 0 && (
        <ToolStatusArea toolCalls={toolCalls} />
      )}
      {showThinking && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-start',
          padding: '0 1rem',
          marginBottom: '0.75rem',
        }}>
          <div style={{
            padding: '0.6rem 0.9rem',
            borderRadius: '8px',
            background: 'var(--vscode-editorWidget-background)',
            color: 'var(--vscode-editor-foreground)',
            fontSize: '0.85rem',
            opacity: 0.7,
          }}>
            <ThinkingDots />
          </div>
        </div>
      )}
      {pendingConfirmation && onConfirm && (
        <div style={{
          padding: '0.75rem 1rem',
          margin: '0 1rem 0.75rem',
          borderRadius: '8px',
          background: 'var(--vscode-editorWidget-background)',
          border: '1px solid var(--vscode-panel-border)',
        }}>
          <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem', opacity: 0.8 }}>
            The agent wants to run:
          </div>
          <code style={{
            display: 'block',
            padding: '0.4rem 0.6rem',
            borderRadius: '4px',
            background: 'var(--vscode-editor-background)',
            marginBottom: '0.75rem',
            fontSize: '0.85rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {pendingConfirmation.command}
          </code>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => onConfirm(pendingConfirmation.id, true)}
              style={{
                background: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
                border: 'none',
                borderRadius: '4px',
                padding: '0.3rem 0.75rem',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Approve
            </button>
            <button
              onClick={() => onConfirm(pendingConfirmation.id, false)}
              style={{
                background: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)',
                border: 'none',
                borderRadius: '4px',
                padding: '0.3rem 0.75rem',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Deny
            </button>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
};

const ThinkingDots: React.FC = () => {
  const [dots, setDots] = React.useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return <span>Thinking{dots}</span>;
};
