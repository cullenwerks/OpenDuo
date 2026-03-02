import React from 'react';

interface Props {
  connected: boolean;
  model?: string;
  onNewChat?: () => void;
  workspaceFolders?: string[];
  activeFolder?: string;
  onFolderChange?: (folder: string) => void;
}

export const Header: React.FC<Props> = ({
  connected, model, onNewChat,
  workspaceFolders, activeFolder, onFolderChange,
}) => (
  <div style={{
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    gap: '8px',
    fontSize: '0.75rem',
    flexShrink: 0,
  }}>
    {/* Left: pulsing dot + model name */}
    <span
      className={`status-dot ${connected ? 'connected' : 'disconnected'}`}
      title={connected ? 'Connected' : 'Disconnected'}
    />
    {model && <span style={{ opacity: 0.6 }}>{model}</span>}

    {/* Center: labeled workspace selector */}
    {workspaceFolders && workspaceFolders.length > 1 && (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '0 auto' }}>
        <span style={{ opacity: 0.6 }}>Workspace</span>
        <select
          value={activeFolder ?? ''}
          onChange={e => onFolderChange?.(e.target.value)}
          title="Switch active workspace folder"
          style={{
            background: 'var(--vscode-dropdown-background, var(--vscode-input-background))',
            color: 'var(--vscode-dropdown-foreground, var(--vscode-input-foreground))',
            border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
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
      </span>
    )}
    {workspaceFolders && workspaceFolders.length === 1 && (
      <span style={{ opacity: 0.6, margin: '0 auto' }} title="Switch active workspace folder">
        Workspace  {workspaceFolders[0]}
      </span>
    )}

    {/* Right: new chat (+) button with hover rotation */}
    <button
      onClick={onNewChat}
      title="New chat"
      style={{
        marginLeft: 'auto',
        background: 'transparent',
        border: 'none',
        color: 'var(--vscode-editor-foreground)',
        cursor: 'pointer',
        fontSize: '1.1rem',
        padding: '2px 4px',
        borderRadius: '4px',
        lineHeight: 1,
        transition: 'transform 0.2s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'rotate(90deg)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'rotate(0deg)'; }}
    >
      +
    </button>
  </div>
);
