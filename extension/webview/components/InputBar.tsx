import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  onSend: (text: string) => void;
  onCancel?: () => void;
  disabled: boolean;
  showCancel?: boolean;
}

const MAX_ROWS = 6;
const LINE_HEIGHT = 20;

export const InputBar: React.FC<Props> = ({ onSend, onCancel, disabled, showCancel }) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS * LINE_HEIGHT)}px`;
  }, []);

  useEffect(() => { autoResize(); }, [value, autoResize]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape' && showCancel)  { e.preventDefault(); onCancel?.(); }
  };

  return (
    <div className="input-card">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled && !showCancel}
        placeholder="Message OpenDuo..."
        title="Enter to send / Shift+Enter for newline / Escape to cancel"
        rows={1}
        style={{
          flex: 1,
          resize: 'none',
          border: 'none',
          background: 'transparent',
          outline: 'none',
          color: 'var(--vscode-input-foreground)',
          fontFamily: 'inherit',
          fontSize: '0.9rem',
          lineHeight: `${LINE_HEIGHT}px`,
          overflow: 'auto',
          padding: '2px 0',
        }}
      />
      {showCancel ? (
        <button
          className="input-btn"
          onClick={onCancel}
          title="Stop generation (Escape)"
          style={{ background: 'var(--vscode-errorForeground, #f44747)' }}
        >
          {/* Stop square */}
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1" y="1" width="8" height="8" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <button
          className="input-btn"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          title="Send (Enter)"
        >
          {/* Up-arrow */}
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M6 1 L6 11 M1 6 L6 1 L11 6"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
};
