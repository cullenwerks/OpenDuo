import React from 'react';

interface Props {
  connected: boolean;
  model?: string;
}

export const StatusBar: React.FC<Props> = ({ connected, model }) => (
  <div style={{
    padding: '0.25rem 1rem',
    fontSize: '0.75rem',
    color: 'var(--vscode-statusBar-foreground)',
    background: 'var(--vscode-statusBar-background)',
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center',
  }}>
    <span style={{ color: connected ? '#4ec9b0' : '#f44747' }}>
      ● {connected ? 'Connected' : 'Disconnected'}
    </span>
    {model && <span>Model: {model}</span>}
    <span style={{ marginLeft: 'auto', opacity: 0.7 }}>OpenDuo</span>
  </div>
);
