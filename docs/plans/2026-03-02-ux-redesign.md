# OpenDuo UX Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate from `WebviewPanel` to a persistent Activity Bar sidebar (`WebviewViewProvider`) and refresh every visual layer: asymmetric message bubbles, streaming cursor animation, labeled workspace selector, styled code blocks with copy/open-in-editor, diff line coloring, tool call progress rows, and floating input card.

**Architecture:** Replace `ChatPanel` with `ChatViewProvider` (implements `vscode.WebviewViewProvider`), registering an Activity Bar container in `package.json`. The `openChat` command is rewired to focus the sidebar instead of creating a panel. All CSS animations use only GPU-composited properties (`opacity`, `transform`, `box-shadow`). `useChat.ts` gains a parallel `toolCalls` state extracted from `[Calling...]` tokens. A new `ToolCallRow.tsx` renders tool progress. `StatusBar.tsx` is replaced by `Header.tsx`.

**Tech Stack:** TypeScript, React 18, marked.js (custom `code` renderer override), VS Code Extension API (`WebviewViewProvider`, `registerWebviewViewProvider`, `workspace.openTextDocument`), CSS keyframe animations, esbuild.

**Design doc:** `docs/plans/2026-03-02-ux-redesign-design.md`

---

### Task 1: Register Activity Bar sidebar in `package.json`

**Files:**
- Modify: `extension/package.json`

**Step 1: Add `viewsContainers` and `views` inside `"contributes"`**

In `extension/package.json`, add the following two properties inside the `"contributes"` object (after the `"configuration"` block, before the closing `}`):

```json
"viewsContainers": {
  "activitybar": [
    {
      "id": "openduo",
      "title": "OpenDuo",
      "icon": "media/icon.svg"
    }
  ]
},
"views": {
  "openduo": [
    {
      "type": "webview",
      "id": "openduo.chatView",
      "name": "OpenDuo Chat"
    }
  ]
},
```

Note: `retainContextWhenHidden` is set programmatically when registering the provider in `extension.ts`; it does not go in `package.json`.

**Step 2: Validate JSON**

Run: `node -e "require('./package.json')" && echo OK`
Working dir: `extension/`
Expected: `OK` (no syntax errors)

**Step 3: Commit**

```bash
git add extension/package.json
git commit -m "feat: register OpenDuo Activity Bar sidebar container"
```

---

### Task 2: Create `ChatViewProvider` (replaces `ChatPanel`)

**Files:**
- Create: `extension/src/chatView.ts`

**Step 1: Create the file with full implementation**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { logInfo, logDebug } from './logger';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);
    logInfo('ChatViewProvider: webview resolved');

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'openCode') {
        logDebug(`ChatViewProvider: openCode received, language=${msg.language}`);
        try {
          const doc = await vscode.workspace.openTextDocument({
            content: msg.code as string,
            language: (msg.language as string) ?? 'plaintext',
          });
          await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Active,
          });
        } catch (err) {
          logDebug(`ChatViewProvider: openCode failed: ${(err as Error).message}`);
        }
      }
    });
  }

  focus(): void {
    this._view?.show(true);
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const webviewUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
    );
    const htmlPath = path.join(this.extensionUri.fsPath, 'dist', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/\$\{cspNonce\}/g, nonce);
    html = html.replace('${webviewUri}', webviewUri.toString());
    html = html.replace('${serverUrl}', 'http://127.0.0.1:8745');
    return html;
  }
}
```

**Step 2: Build to confirm TypeScript compiles**

Run: `npm run build`
Working dir: `extension/`
Expected: exits 0, no errors

**Step 3: Commit**

```bash
git add extension/src/chatView.ts
git commit -m "feat: add ChatViewProvider WebviewViewProvider"
```

---

### Task 3: Wire `ChatViewProvider` into `extension.ts`

**Files:**
- Modify: `extension/src/extension.ts`

**Step 1: Swap `ChatPanel` import for `ChatViewProvider`**

Line 7 currently reads:
```typescript
import { ChatPanel } from './chatPanel';
```

Replace with:
```typescript
import { ChatViewProvider } from './chatView';
```

**Step 2: Register the provider at activation time**

After line 18 (`const patManager = new PatManager(context.secrets);`), insert:

```typescript
const chatViewProvider = new ChatViewProvider(context.extensionUri);
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(
    'openduo.chatView',
    chatViewProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  )
);
```

**Step 3: Rewire the `openChat` command**

Find the line near the end of the `openChat` handler (currently):
```typescript
ChatPanel.createOrShow(context.extensionUri, serverManager.serverUrl());
```

Replace with:
```typescript
await vscode.commands.executeCommand('workbench.view.extension.openduo');
```

**Step 4: Build**

Run: `npm run build`
Working dir: `extension/`
Expected: exits 0

**Step 5: Commit**

```bash
git add extension/src/extension.ts
git commit -m "feat: register sidebar provider and rewire openChat command"
```

---

### Task 4: Add all new CSS to `webview/index.html`

**Files:**
- Modify: `extension/webview/index.html`

**Step 1: Append new CSS rules inside the `<style>` tag**

Add the following block inside `<style>` in `extension/webview/index.html`, immediately after the existing `.markdown-body .tool-call { ... }` rule (before the `</style>` closing tag):

```css
/* ── Streaming cursor ──────────────────────────────────────── */
@keyframes cursor-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
.streaming-cursor {
  width: 2px;
  height: 1.1em;
  background: var(--vscode-editor-foreground);
  display: inline-block;
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: cursor-blink 0.8s step-end infinite;
  transition: opacity 0.4s ease, width 0.3s ease;
}
.streaming-cursor.done {
  opacity: 0;
  width: 0;
}

/* ── Message enter animation ───────────────────────────────── */
@keyframes fade-slide-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.message-enter { animation: fade-slide-in 200ms ease-out forwards; }

/* ── CSS thinking dots (replaces JS interval) ──────────────── */
@keyframes thinking-dot {
  0%, 80%, 100% { transform: scale(1);   opacity: 0.4; }
  40%            { transform: scale(1.4); opacity: 1;   }
}
.thinking-dots { display: flex; gap: 4px; align-items: center; padding: 2px 0; }
.thinking-dots span {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: currentColor;
  display: inline-block;
}
.thinking-dots .dot-1 { animation: thinking-dot 1.2s ease-in-out infinite 0.0s; }
.thinking-dots .dot-2 { animation: thinking-dot 1.2s ease-in-out infinite 0.2s; }
.thinking-dots .dot-3 { animation: thinking-dot 1.2s ease-in-out infinite 0.4s; }

/* ── Code block chrome ─────────────────────────────────────── */
.code-block {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  overflow: hidden;
  margin: 0.5em 0;
}
.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 10px;
  background: var(--vscode-editorGroupHeader-tabsBackground);
  font-size: 0.75rem;
}
.code-lang { opacity: 0.6; }
.code-actions button {
  background: transparent;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  color: var(--vscode-editor-foreground);
  padding: 2px 8px;
  font-size: 0.7rem;
  cursor: pointer;
  margin-left: 4px;
  transition: opacity 0.15s, transform 0.1s;
}
.code-actions button:active { transform: scale(0.96); }

/* Override inline code inside code-blocks to strip extra border */
.code-block pre code {
  background: none !important;
  border: none !important;
  padding: 0 !important;
  border-radius: 0 !important;
}

/* ── Diff line coloring ────────────────────────────────────── */
.diff-add    { background: rgba(70, 200, 80, 0.12); display: block; }
.diff-remove { background: rgba(240, 60, 60, 0.12); display: block; }

/* ── Tool call rows ────────────────────────────────────────── */
.tool-call-row {
  position: relative;
  border-left: 3px solid var(--vscode-button-background);
  border-radius: 6px;
  background: var(--vscode-editorWidget-background);
  margin: 4px 12px;
  padding: 6px 10px;
  font-size: 0.8rem;
  overflow: hidden;
}
.tool-call-row.error { border-left-color: var(--vscode-errorForeground); }
.tool-call-row.done  { opacity: 0.7; }
.tool-call-row-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.tool-call-name   { font-weight: 600; }
.tool-call-params { opacity: 0.6; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-call-elapsed { opacity: 0.5; font-size: 0.7rem; margin-left: auto; }
.tool-call-chevron { opacity: 0.6; transition: transform 0.15s; }
.tool-call-chevron.open { transform: rotate(90deg); }
.tool-call-body {
  margin-top: 6px;
  font-size: 0.75rem;
  opacity: 0.7;
  white-space: pre-wrap;
  word-break: break-all;
}
@keyframes progress-fill {
  from { width: 0%; }
  to   { width: 100%; }
}
.tool-call-progress {
  position: absolute;
  bottom: 0; left: 0;
  height: 2px;
  background: var(--vscode-button-background);
  animation: progress-fill 8s linear forwards;
  opacity: 0.5;
}
.tool-call-progress.done { opacity: 0; transition: opacity 0.4s; }

/* ── Pulsing connection dot ────────────────────────────────── */
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.5; transform: scale(0.8); }
}
.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.status-dot.connected    { background: #4ec9b0; animation: pulse-dot 2s ease-in-out infinite; }
.status-dot.disconnected { background: #f44747; }

/* ── Floating input card ───────────────────────────────────── */
.input-card {
  margin: 8px;
  border-radius: 12px;
  border: 1px solid var(--vscode-panel-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  background: var(--vscode-input-background);
  display: flex;
  align-items: flex-end;
  padding: 6px 8px;
  gap: 6px;
  transition: box-shadow 0.15s;
}
.input-card:focus-within {
  box-shadow: 0 0 0 2px var(--vscode-focusBorder), 0 2px 8px rgba(0, 0, 0, 0.15);
}
.input-btn {
  width: 24px; height: 24px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.15s, transform 0.1s;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.input-btn:active   { transform: scale(0.96); }
.input-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* ── Micro-interaction defaults ────────────────────────────── */
button { transition: opacity 0.15s, transform 0.1s; }
button:active { transform: scale(0.96); }
```

**Step 2: Build**

Run: `npm run build`
Working dir: `extension/`
Expected: exits 0

**Step 3: Commit**

```bash
git add extension/webview/index.html
git commit -m "feat: add UX redesign CSS (animations, code blocks, diff, tool rows, input card)"
```

---

### Task 5: Extract tool calls into parallel state in `useChat.ts`

**Files:**
- Modify: `extension/webview/hooks/useChat.ts`
- Test: `extension/webview/hooks/useChat.test.ts`

**Step 1: Write the failing tests**

Add to `extension/webview/hooks/useChat.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { appendToken, createMessage, parseToolCallToken } from './useChat';

// ... (keep existing tests) ...

describe('parseToolCallToken', () => {
  it('parses a basic tool call token', () => {
    const result = parseToolCallToken('[Calling list_issues...]');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('list_issues');
    expect(result!.params).toBe('');
  });

  it('returns null for non-tool-call tokens', () => {
    expect(parseToolCallToken('Hello world')).toBeNull();
    expect(parseToolCallToken('[DONE]')).toBeNull();
    expect(parseToolCallToken('[ERROR] something')).toBeNull();
  });

  it('captures params after the tool name', () => {
    const result = parseToolCallToken('[Calling list_issues state:open...]');
    expect(result!.name).toBe('list_issues');
    expect(result!.params).toBe('state:open');
  });

  it('handles dotted tool names', () => {
    const result = parseToolCallToken('[Calling gitlab.list_issues...]');
    expect(result!.name).toBe('gitlab.list_issues');
  });
});
```

**Step 2: Run to verify failure**

Run: `npm run test`
Working dir: `extension/`
Expected: FAIL — `parseToolCallToken` is not exported from `./useChat`

**Step 3: Add `ToolCallEntry` type and `parseToolCallToken` to `useChat.ts`**

After the existing type exports (after `PendingConfirmation` interface), add:

```typescript
export interface ToolCallEntry {
  id: string;
  name: string;
  params: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'done' | 'error';
  resultSummary?: string;
}

export function parseToolCallToken(data: string): { name: string; params: string } | null {
  const match = data.match(/^\[Calling ([\w.]+)(?:\s+([^\]]*?))?\.\.\.\]$/);
  if (!match) return null;
  return { name: match[1], params: match[2]?.trim() ?? '' };
}
```

**Step 4: Add `toolCalls` state to the hook body**

In the `useChat` function, after `const abortRef = useRef<AbortController | null>(null);`, add:

```typescript
const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);
```

**Step 5: Route `[Calling...]` tokens away from message content**

Inside the SSE processing loop, find the section that checks `confirmMatch` and falls through to the normal token append. Replace it with:

```typescript
const confirmMatch = data.match(/^\n?\[CONFIRM:([\w-]+)\] (.+)\n?$/);
if (confirmMatch) {
  setPendingConfirmation({ id: confirmMatch[1], command: confirmMatch[2] });
} else {
  const toolCallMatch = parseToolCallToken(data);
  if (toolCallMatch) {
    const entry: ToolCallEntry = {
      id: crypto.randomUUID(),
      name: toolCallMatch.name,
      params: toolCallMatch.params,
      startTime: Date.now(),
      status: 'running',
    };
    setToolCalls(prev => [...prev, entry]);
  } else {
    // Normal token — append to message
    setMessages(prev => prev.map(m =>
      m.id === assistantMsg.id
        ? appendToken(m, data)
        : m
    ));
  }
}
```

**Step 6: Mark running tool calls as done in the `finally` block**

Inside `sendMessage`'s `finally` block, after `setIsLoading(false)`:

```typescript
setToolCalls(prev => prev.map(tc =>
  tc.status === 'running' ? { ...tc, status: 'done', endTime: Date.now() } : tc
));
```

**Step 7: Clear tool calls in `resetChat`**

In the `resetChat` callback, after `setMessages([])`:

```typescript
setToolCalls([]);
```

**Step 8: Include `toolCalls` in the return value**

Replace the existing `return` statement:
```typescript
return { messages, isLoading, sendMessage, cancelRequest, resetChat, pendingConfirmation, confirmCommand, toolCalls };
```

**Step 9: Run tests to confirm pass**

Run: `npm run test`
Working dir: `extension/`
Expected: All tests PASS

**Step 10: Commit**

```bash
git add extension/webview/hooks/useChat.ts extension/webview/hooks/useChat.test.ts
git commit -m "feat: extract tool call tokens into parallel toolCalls state"
```

---

### Task 6: Create `ToolCallRow.tsx`

**Files:**
- Create: `extension/webview/components/ToolCallRow.tsx`

**Step 1: Create the file**

```tsx
import React, { useState, useEffect, useRef } from 'react';
import type { ToolCallEntry } from '../hooks/useChat';

interface RowProps { entry: ToolCallEntry; }

export const ToolCallRow: React.FC<RowProps> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (entry.status === 'running') {
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - entry.startTime);
      }, 100);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setElapsed((entry.endTime ?? Date.now()) - entry.startTime);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [entry.status, entry.startTime, entry.endTime]);

  const statusIcon =
    entry.status === 'running' ? '◉' :
    entry.status === 'done'    ? '✓' : '✗';

  const rowClass = [
    'tool-call-row',
    entry.status === 'error' ? 'error' : '',
    entry.status === 'done'  ? 'done'  : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClass}>
      <div className="tool-call-row-header" onClick={() => setExpanded(e => !e)}>
        <span>{statusIcon}</span>
        <span className="tool-call-name">{entry.name}</span>
        {entry.params && <span className="tool-call-params">{entry.params}</span>}
        <span className="tool-call-elapsed">⏱ {(elapsed / 1000).toFixed(1)}s</span>
        <span className={`tool-call-chevron${expanded ? ' open' : ''}`}>▶</span>
      </div>
      {expanded && entry.resultSummary && (
        <div className="tool-call-body">{entry.resultSummary.slice(0, 300)}</div>
      )}
      <div className={`tool-call-progress${entry.status !== 'running' ? ' done' : ''}`} />
    </div>
  );
};

interface AreaProps { toolCalls: ToolCallEntry[]; }

export const ToolStatusArea: React.FC<AreaProps> = ({ toolCalls }) => {
  if (toolCalls.length === 0) return null;
  return (
    <div style={{ paddingBottom: '4px' }}>
      {toolCalls.map(tc => <ToolCallRow key={tc.id} entry={tc} />)}
    </div>
  );
};
```

**Step 2: Build**

Run: `npm run build`
Working dir: `extension/`
Expected: exits 0

**Step 3: Commit**

```bash
git add extension/webview/components/ToolCallRow.tsx
git commit -m "feat: add ToolCallRow and ToolStatusArea components"
```

---

### Task 7: Create `Header.tsx` (replaces `StatusBar.tsx`)

**Files:**
- Create: `extension/webview/components/Header.tsx`

**Step 1: Create the file**

```tsx
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
        <span style={{ opacity: 0.6 }}>📁 Workspace</span>
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
        📁 Workspace  {workspaceFolders[0]}
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
```

**Step 2: Build**

Run: `npm run build`
Working dir: `extension/`
Expected: exits 0

**Step 3: Commit**

```bash
git add extension/webview/components/Header.tsx
git commit -m "feat: add Header component with labeled workspace selector and pulsing dot"
```

---

### Task 8: Update `ChatApp.tsx` — wire `Header`, `ToolStatusArea`, and `toolCalls`

**Files:**
- Modify: `extension/webview/components/ChatApp.tsx`

**Step 1: Update imports**

Replace:
```typescript
import { StatusBar } from './StatusBar';
```
With:
```typescript
import { Header } from './Header';
import { ToolStatusArea } from './ToolCallRow';
```

**Step 2: Destructure `toolCalls` from `useChat`**

Replace:
```typescript
const { messages, isLoading, sendMessage, cancelRequest, resetChat, pendingConfirmation, confirmCommand } = useChat(SERVER_URL, getActiveFolder);
```
With:
```typescript
const { messages, isLoading, sendMessage, cancelRequest, resetChat, pendingConfirmation, confirmCommand, toolCalls } = useChat(SERVER_URL, getActiveFolder);
```

**Step 3: Replace `<StatusBar>` with `<Header>` and add `<ToolStatusArea>`**

Replace the JSX return block with:
```tsx
return (
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <Header
      connected={connected}
      model="GitLab Duo (Agentic)"
      onNewChat={resetChat}
      workspaceFolders={workspaceFolders}
      activeFolder={activeFolder}
      onFolderChange={setActiveFolder}
    />
    <ChatWindow
      messages={messages}
      isLoading={isLoading}
      onExampleClick={(text) => sendMessage(text)}
      pendingConfirmation={pendingConfirmation}
      onConfirm={confirmCommand}
    />
    <ToolStatusArea toolCalls={toolCalls} />
    <InputBar
      onSend={(text) => sendMessage(text)}
      onCancel={cancelRequest}
      disabled={isLoading}
      showCancel={isLoading}
    />
  </div>
);
```

**Step 4: Build**

Run: `npm run build`
Working dir: `extension/`
Expected: exits 0

**Step 5: Commit**

```bash
git add extension/webview/components/ChatApp.tsx
git commit -m "feat: wire Header and ToolStatusArea into ChatApp"
```

---

### Task 9: Update `ChatWindow.tsx` — replace JS `ThinkingDots` with CSS version

**Files:**
- Modify: `extension/webview/components/ChatWindow.tsx`

**Step 1: Replace the `ThinkingDots` component at the bottom of the file**

The current implementation (lines 164–175) uses `setInterval`. Replace the entire `ThinkingDots` function with:

```tsx
const ThinkingDots: React.FC = () => (
  <div className="thinking-dots">
    <span className="dot-1" />
    <span className="dot-2" />
    <span className="dot-3" />
  </div>
);
```

Also remove the `useEffect` import if it is no longer used in `ChatWindow` after this change (the scroll effect still uses it, so keep it).

**Step 2: Build and run tests**

Run: `npm run test && npm run build`
Working dir: `extension/`
Expected: All tests PASS, exits 0

**Step 3: Commit**

```bash
git add extension/webview/components/ChatWindow.tsx
git commit -m "feat: replace JS ThinkingDots interval with CSS animation"
```

---

### Task 10: Update `MessageBubble.tsx` — streaming cursor, code renderer, event delegation

This is the most complex task. The file gets three additions:
1. A custom `marked` `code` renderer that outputs structured HTML with Copy/Open buttons
2. An event-delegation `click` handler on the container (CSP-safe; no inline `onclick`)
3. A `streaming-cursor` span and `message-enter` fade-in animation class

**Files:**
- Modify: `extension/webview/components/MessageBubble.tsx`

**Step 1: Update the imports at the top**

Replace:
```typescript
import React, { useMemo } from 'react';
```
With:
```typescript
import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import vscode from '../vscode';
```

**Step 2: Add `escapeHtml`, diff renderer, and replace `marked.use` config**

After the import lines, replace the entire existing `marked.use({ ... })` block with:

```typescript
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDiffLine(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return escapeHtml(line);
  if (line.startsWith('+')) return `<span class="diff-add">${escapeHtml(line)}</span>`;
  if (line.startsWith('-')) return `<span class="diff-remove">${escapeHtml(line)}</span>`;
  return escapeHtml(line);
}

marked.use({
  renderer: {
    html(): string { return ''; },
    code(token: { text: string; lang?: string }): string {
      const lang = token.lang || 'text';
      const raw = encodeURIComponent(token.text);
      const isDiff = lang === 'diff' || lang === 'patch';
      const body = isDiff
        ? token.text.split('\n').map(renderDiffLine).join('\n')
        : escapeHtml(token.text);
      return `<div class="code-block" data-lang="${lang}">
  <div class="code-header">
    <span class="code-lang">${escapeHtml(lang)}</span>
    <div class="code-actions">
      <button data-action="copy" data-raw="${raw}">Copy</button>
      <button data-action="open" data-raw="${raw}" data-lang="${escapeHtml(lang)}">Open ↗</button>
    </div>
  </div>
  <pre><code class="language-${escapeHtml(lang)}">${body}</code></pre>
</div>`;
    },
  },
});
```

**Step 3: Replace the `MessageBubble` component**

Replace the entire `MessageBubble` export (from `export const MessageBubble` through the closing `};`) with:

```tsx
export const MessageBubble: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';
  const containerRef = useRef<HTMLDivElement>(null);
  const [animating, setAnimating] = useState(true);

  const html = useMemo(() => {
    if (isUser) return null;
    return renderMarkdown(message.content);
  }, [isUser, message.content]);

  const handleClick = useCallback((e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const raw = target.dataset.raw;
    if (!raw) return;
    const decoded = decodeURIComponent(raw);
    if (action === 'copy') {
      navigator.clipboard.writeText(decoded).catch(() => {});
      const orig = target.textContent ?? 'Copy';
      target.textContent = 'Copied ✓';
      setTimeout(() => { target.textContent = orig; }, 1500);
    } else if (action === 'open') {
      const lang = target.dataset.lang ?? 'plaintext';
      vscode.postMessage({ type: 'openCode', code: decoded, language: lang });
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('click', handleClick as EventListener);
    return () => el.removeEventListener('click', handleClick as EventListener);
  }, [handleClick]);

  const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: isUser ? 'flex-end' : 'flex-start',
    marginBottom: '16px',
    padding: '0 12px',
  };

  if (isUser) {
    return (
      <div
        className={animating ? 'message-enter' : undefined}
        onAnimationEnd={() => setAnimating(false)}
        style={wrapperStyle}
      >
        <div style={{
          maxWidth: '78%',
          padding: '0.6rem 0.9rem',
          borderRadius: '18px',
          background: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: '0.9rem',
          lineHeight: '1.5',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}>
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className={animating ? 'message-enter' : undefined}
      onAnimationEnd={() => setAnimating(false)}
      style={wrapperStyle}
    >
      <div
        ref={containerRef}
        className="markdown-body"
        style={{
          width: '100%',
          borderLeft: '2px solid var(--vscode-button-background)',
          paddingLeft: '10px',
          fontSize: '0.9rem',
          lineHeight: '1.5',
          wordBreak: 'break-word',
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: html! }} />
        <span className={`streaming-cursor${message.isStreaming ? '' : ' done'}`} />
      </div>
    </div>
  );
};
```

**Step 4: Build and run tests**

Run: `npm run test && npm run build`
Working dir: `extension/`
Expected: All tests PASS, exits 0

**Step 5: Commit**

```bash
git add extension/webview/components/MessageBubble.tsx
git commit -m "feat: add streaming cursor, code block renderer, and CSP-safe event delegation"
```

---

### Task 11: Update `InputBar.tsx` — floating card, icon buttons, Escape to cancel

**Files:**
- Modify: `extension/webview/components/InputBar.tsx`

**Step 1: Replace the entire component**

```tsx
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
        placeholder="Message OpenDuo…"
        title="Enter to send · Shift+Enter for newline · Escape to cancel"
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
```

**Step 2: Build and run tests**

Run: `npm run test && npm run build`
Working dir: `extension/`
Expected: exits 0

**Step 3: Commit**

```bash
git add extension/webview/components/InputBar.tsx
git commit -m "feat: floating card input bar with SVG icon buttons and Escape to cancel"
```

---

### Task 12: Remove `StatusBar.tsx` and final verification

**Files:**
- Delete: `extension/webview/components/StatusBar.tsx`

**Step 1: Remove the file**

```bash
git rm extension/webview/components/StatusBar.tsx
```

**Step 2: Final build and tests**

Run: `npm run test && npm run build`
Working dir: `extension/`
Expected: All tests PASS, exits 0

**Step 3: Confirm no remaining import of `StatusBar`**

Run: `grep -r "StatusBar" extension/webview/ extension/src/`
Expected: no output (zero matches)

**Step 4: Final commit**

```bash
git commit -m "chore: remove StatusBar.tsx (superseded by Header.tsx)"
```

---

## Summary of files changed

| File | Action |
|------|--------|
| `extension/package.json` | Add `viewsContainers` + `views` |
| `extension/src/chatView.ts` | Create — `WebviewViewProvider` |
| `extension/src/extension.ts` | Register provider, rewire `openChat` |
| `extension/webview/index.html` | Add all CSS |
| `extension/webview/hooks/useChat.ts` | Add `ToolCallEntry`, `parseToolCallToken`, `toolCalls` state |
| `extension/webview/hooks/useChat.test.ts` | Add `parseToolCallToken` tests |
| `extension/webview/components/ToolCallRow.tsx` | Create |
| `extension/webview/components/Header.tsx` | Create |
| `extension/webview/components/ChatApp.tsx` | Wire `Header` + `ToolStatusArea` |
| `extension/webview/components/ChatWindow.tsx` | CSS `ThinkingDots` |
| `extension/webview/components/MessageBubble.tsx` | Code renderer, cursor, event delegation |
| `extension/webview/components/InputBar.tsx` | Floating card |
| `extension/webview/components/StatusBar.tsx` | Delete |
