import React from 'react';

interface Props {
  connected: boolean;
  model?: string;
  onNewChat?: () => void;
  showNewChat?: boolean;
  workspaceFolders?: string[];
  activeFolder?: string;
  onFolderChange?: (folder: string) => void;
}

export const StatusBar: React.FC<Props> = ({
  connected, model, onNewChat, showNewChat,
  workspaceFolders, activeFolder, onFolderChange,
}) => (
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
      {connected ? 'Connected' : 'Disconnected'}
    </span>
    {model && <span style={{ opacity: 0.7 }}>{model}</span>}
    {workspaceFolders && workspaceFolders.length > 1 && (
      <select
        value={activeFolder ?? ''}
        onChange={e => onFolderChange?.(e.target.value)}
        title="Active workspace folder"
        style={{
          background: 'var(--vscode-dropdown-background, var(--vscode-input-background))',
          color: 'var(--vscode-dropdown-foreground, var(--vscode-input-foreground))',
          border: '1px solid var(--vscode-dropdown-border, var(--vscode-input-border))',
          borderRadius: '3px',
          padding: '1px 4px',
          fontSize: '0.7rem',
          cursor: 'pointer',
        }}
      >
        {workspaceFolders.map(f => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
    )}
    {workspaceFolders && workspaceFolders.length === 1 && (
      <span style={{ opacity: 0.6 }} title="Workspace folder">
        {workspaceFolders[0]}
      </span>
    )}
    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {showNewChat && (
        <button
          onClick={onNewChat}
          title="New Chat"
          style={{
            background: 'transparent',
            border: '1px solid var(--vscode-statusBar-foreground, #ccc)',
            color: 'var(--vscode-statusBar-foreground)',
            borderRadius: '3px',
            padding: '1px 6px',
            cursor: 'pointer',
            fontSize: '0.7rem',
            opacity: 0.8,
          }}
        >
          + New Chat
        </button>
      )}
      <span style={{ opacity: 0.7 }}>OpenDuo</span>
    </span>
  </div>
);
