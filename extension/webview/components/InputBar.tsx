import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  onSend: (text: string) => void;
  onCancel?: () => void;
  disabled: boolean;
  showCancel?: boolean;
}

const MIN_ROWS = 1;
const MAX_ROWS = 6;
const LINE_HEIGHT = 20; // approximate px per row

export const InputBar: React.FC<Props> = ({ onSend, onCancel, disabled, showCancel }) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = MAX_ROWS * LINE_HEIGHT;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{
      display: 'flex',
      padding: '0.75rem 1rem',
      gap: '0.5rem',
      borderTop: '1px solid var(--vscode-panel-border)',
      alignItems: 'flex-end',
    }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Ask anything... (Enter to send, Shift+Enter for newline)"
        rows={MIN_ROWS}
        style={{
          flex: 1,
          resize: 'none',
          padding: '0.5rem',
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: '1px solid var(--vscode-input-border)',
          borderRadius: '4px',
          fontFamily: 'inherit',
          fontSize: '0.9rem',
          lineHeight: `${LINE_HEIGHT}px`,
          overflow: 'auto',
        }}
      />
      {showCancel ? (
        <button
          onClick={onCancel}
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--vscode-errorForeground, #f44747)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Stop
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '4px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          Send
        </button>
      )}
    </div>
  );
};
