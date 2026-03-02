# OpenDuo UX Redesign — Design Document

**Date:** 2026-03-02
**Approach:** B — Full refresh + sidebar migration
**Status:** Approved, pending implementation plan

---

## Overview

Replace the current `WebviewPanel` (tab beside editor) with a persistent `WebviewViewProvider` in the VS Code Activity Bar. Refresh every visual layer: streaming cursor animation, elevated message layout, labeled workspace selector, styled code blocks with copy/open-in-editor, diff line coloring, structured tool-call rows with progress, and a floating card input bar.

No new runtime dependencies except `highlight.js` for syntax coloring. All animations use GPU-composited CSS properties only (`opacity`, `transform`, `box-shadow`) — no layout-thrashing during token streaming.

---

## Section 1 — Architecture: Sidebar Migration

### package.json contributions

Add a `viewsContainers` entry to register an Activity Bar slot using the existing `media/icon.svg`. Add a `views` entry registering a `webview`-type view under that container with id `openduo.chatView`.

The existing `openduo.openChat` command is rewired to focus the sidebar (`workbench.view.extension.openduo`) instead of creating a WebviewPanel — keyboard-shortcut users stay unbroken.

### Extension host

`ChatPanel` becomes `ChatViewProvider` implementing `vscode.WebviewViewProvider`. VS Code calls `resolveWebviewView(webviewView)` once when the sidebar is first revealed. The provider:

1. Builds the same HTML as today (same nonce injection, same `window.__OPENDUO_SERVER_URL__` injection at fixed port 8745)
2. Wires `webviewView.webview.onDidReceiveMessage` for the new `openCode` message type (see Section 4)
3. Starts the server lazily — same PAT/settings flow, same `ServerManager`

The webview's existing 10-second health-check loop in `ChatApp.tsx` handles the "connecting" gap between view-open and server-ready. No new loading UI needed in the extension host.

Register with `retainContextWhenHidden: true` so chat state survives when the user switches sidebar panels.

### What is unchanged

- `ServerManager` and all server-side code
- `useChat.ts` SSE streaming hook
- All tool files, providers, react loop
- Component file/import structure (modified, not replaced)

---

## Section 2 — Visual Design: Layout, Spacing & Typography

### Three-zone shell

```
┌─────────────────────────────────┐
│  HEADER  (32px fixed)           │
├─────────────────────────────────┤
│  MESSAGE FEED  (flex: 1)        │
├─────────────────────────────────┤
│  TOOL STATUS  (0 → auto)        │
├─────────────────────────────────┤
│  INPUT CARD  (auto, min 44px)   │
└─────────────────────────────────┘
```

### Header (replaces StatusBar)

Single 32px line, no border, blends into background:
- Left: pulsing connection dot (green `#4ec9b0` / red `#f44747`) + model name at `opacity: 0.6`
- Center: `📁 Workspace  [folder-name ▾]` — labeled dropdown; plain text when only one folder
- Right: `+` new-chat icon button (`rotate 0→90deg` on hover)

The workspace selector fix: always show `📁 Workspace` label so users immediately understand the control. `title="Switch active workspace folder"` tooltip. Hidden entirely when no workspace is open.

### Message bubbles

**User messages:** pill-shaped (`border-radius: 18px`), right-aligned, `background: var(--vscode-button-background)`, max-width 78%, `box-shadow: 0 1px 3px rgba(0,0,0,0.2)`.

**Assistant messages:** no bubble — text flows left-aligned, full width, document-style. Left decoration: `border-left: 2px solid var(--vscode-button-background)` with `padding-left: 10px`, fades in on first render. This is the key visual shift from "chat toy" to "AI assistant".

**Spacing:** 16px gap between messages, 12px horizontal padding. Typography unchanged (`0.9rem / 1.5 line-height`, VS Code font family variable).

### Empty state

Example prompt chips: `border-radius: 10px`, `transition: background 0.15s, transform 0.1s`, `translateY(-1px)` on hover with subtle `box-shadow`. Subtitle bumped to `opacity: 0.5`.

---

## Section 3 — Animations

### Streaming cursor (cursor-lead typewriter)

A `<span class="streaming-cursor">` at the tail of assistant message content. Thin `2px × 1.1em` vertical bar, `display: inline-block`, positioned inline so it sits where the next character would land.

```css
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
```

React: toggle `done` class when `isStreaming` flips to `false`. Zero JS timers.

### Message enter animation

Each `MessageBubble` mounts with `fade-slide-in`: `opacity 0→1` + `translateY(6px→0)` over `200ms ease-out`. CSS class added on mount, removed via `onAnimationEnd`. Streaming tokens do not re-trigger it.

```css
@keyframes fade-slide-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.message-enter { animation: fade-slide-in 200ms ease-out forwards; }
```

### Thinking indicator

Three `<span>` dots, pure CSS staggered pulse:

```css
@keyframes thinking-dot {
  0%, 80%, 100% { transform: scale(1);   opacity: 0.4; }
  40%            { transform: scale(1.4); opacity: 1;   }
}
.dot-1 { animation: thinking-dot 1.2s ease-in-out infinite 0.0s; }
.dot-2 { animation: thinking-dot 1.2s ease-in-out infinite 0.2s; }
.dot-3 { animation: thinking-dot 1.2s ease-in-out infinite 0.4s; }
```

Replaces the JS-interval "Thinking..." text in `ThinkingDots`.

### Micro-interactions

All buttons: `transition: opacity 0.15s, transform 0.1s`. Press: `scale(0.96)` via `:active`.
Input focus: `box-shadow: 0 0 0 2px var(--vscode-focusBorder)` with `transition: box-shadow 0.15s`.
New chat `+`: `rotate(0deg→90deg)` on hover over `200ms`.

**Constraint:** every animation uses only `opacity`, `transform`, `box-shadow` — GPU-composited only, no reflow triggers.

---

## Section 4 — Code Blocks & Diffs

### Custom marked renderer

Override `code(code, language)` in the existing `marked.use()` call:

```typescript
code(code: string, language: string | undefined): string {
  const lang = language || 'text';
  const escaped = escapeHtml(code);
  const raw = encodeURIComponent(code);
  return `
    <div class="code-block" data-lang="${lang}" data-raw="${raw}">
      <div class="code-header">
        <span class="code-lang">${lang}</span>
        <div class="code-actions">
          <button data-action="copy" data-raw="${raw}">Copy</button>
          <button data-action="open" data-raw="${raw}" data-lang="${lang}">Open ↗</button>
        </div>
      </div>
      <pre><code class="language-${lang}">${escaped}</code></pre>
    </div>`;
}
```

### Event delegation (CSP-safe)

`MessageBubble` attaches one `click` listener to its container ref. Handler uses `.closest('[data-action]')` to find the target button, reads `data-action`, `data-raw`, `data-lang`:

- `copy`: `navigator.clipboard.writeText(decoded)` — button label changes to `Copied ✓` for 1.5s
- `open`: `vscode.postMessage({ type: 'openCode', code: decoded, language: lang })`

No inline `onclick` attributes — fully compliant with the nonce-based CSP.

### Extension host handler

In `ChatViewProvider.resolveWebviewView`:

```typescript
webviewView.webview.onDidReceiveMessage(async (msg) => {
  if (msg.type === 'openCode') {
    const doc = await vscode.workspace.openTextDocument({
      content: msg.code,
      language: msg.language ?? 'plaintext',
    });
    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Active,
    });
  }
});
```

No `TextDocumentContentProvider` needed — `openTextDocument({ content })` handles virtual documents directly.

### Diff coloring

When `language === 'diff' || language === 'patch'`, the renderer processes lines before escaping: lines starting with `+` (not `+++`) get `<span class="diff-add">`, lines with `-` (not `---`) get `<span class="diff-remove">`.

```css
.diff-add    { background: rgba(70, 200, 80, 0.12); display: block; }
.diff-remove { background: rgba(240, 60, 60, 0.12); display: block; }
```

`rgba` composites correctly over any VS Code theme.

### Inline code

Inline backtick spans: `background: var(--vscode-textBlockQuote-background)`, `border: 1px solid var(--vscode-panel-border)`.

### Code block chrome

```css
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
```

---

## Section 5 — Tool Call Status Rows

### Data model change in `useChat.ts`

Extract `[Calling toolName...]` tokens from the assistant message stream into a parallel `toolCalls` state array:

```typescript
interface ToolCallEntry {
  id: string;
  name: string;
  params: string;      // raw param string parsed from token
  startTime: number;
  endTime?: number;
  status: 'running' | 'done' | 'error';
  resultSummary?: string;
}
```

The `[Calling ...]` tokens are removed from the message content and stored in `toolCalls` instead. Tool results (when they appear) update the corresponding entry's `resultSummary` and `endTime`.

### Visual structure

```
[spinner] list_issues  —  state: open · project: frontend    ⏱ 1.2s  [▶]
```

- `border-left: 3px solid var(--vscode-button-background)`, `border-radius: 6px`
- `background: var(--vscode-editorWidget-background)`
- Progress bar along the bottom edge: `width: 0→100%` over 8s `linear`. Completes + fades when done.
- Elapsed time: `setInterval(100ms)` while running, freezes when `endTime` set
- Chevron `▶/▼` toggles expand to show `resultSummary` (first 300 chars)

### State phases

| Phase   | Left indicator | Border color                      | Opacity |
|---------|---------------|-----------------------------------|---------|
| Running | Pulsing dot   | `var(--vscode-button-background)` | 1.0     |
| Done ✓  | `✓` checkmark | `var(--vscode-button-background)` | 0.7     |
| Error ✗ | `✗`           | `var(--vscode-errorForeground)`   | 1.0     |

New component: `ToolCallRow.tsx`. Rendered in a `ToolStatusArea` between `ChatWindow` and `InputBar` — collapses to 0 height when no tool calls are active.

---

## Section 6 — Input Bar

### Floating card

Detaches from hard bottom edge:

```css
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
}
```

Top border-line removed — shadow provides separation.

### Textarea

- `border: none`, `background: transparent`, `outline: none`
- Focus indicator: `box-shadow: inset 0 0 0 1px var(--vscode-focusBorder)` on the card (not the textarea)
- Placeholder: `"Message OpenDuo…"`
- Auto-resize: unchanged (existing logic works well)
- `Shift+Enter` hint removed from placeholder — moved to `title` tooltip

### Send / Stop button

24×24px icon button, `border-radius: 8px`, `background: var(--vscode-button-background)`:

- Idle: `↑` arrow SVG (inline, 16×16)
- Streaming: `■` stop square SVG — same position, icon swaps with `scale(0.8)→scale(1)` transition
- Disabled: `opacity: 0.35`

### Keyboard shortcuts added

| Key        | Action                          |
|------------|--------------------------------|
| `Enter`    | Send (existing)                |
| `Shift+Enter` | Newline (existing)          |
| `Escape`   | Cancel in-flight request (new) |

`Escape` wired via `onKeyDown` in `InputBar` — calls `onCancel` prop, same as the Stop button.

---

## Files Affected

| File | Change type |
|------|-------------|
| `extension/package.json` | Add `viewsContainers`, `views`, rewire `openChat` command |
| `extension/src/chatPanel.ts` → `chatView.ts` | Replace `WebviewPanel` with `WebviewViewProvider` |
| `extension/src/extension.ts` | Register provider, remove panel creation |
| `extension/webview/index.html` | Add all CSS (animations, code blocks, diff, tool rows, input card) |
| `extension/webview/components/ChatApp.tsx` | Wire provider `vscode` API, pass `toolCalls` state |
| `extension/webview/components/ChatWindow.tsx` | Message enter animation, remove ThinkingDots JS timer |
| `extension/webview/components/MessageBubble.tsx` | Event delegation for code blocks, streaming cursor class |
| `extension/webview/components/StatusBar.tsx` → `Header.tsx` | Full redesign |
| `extension/webview/components/InputBar.tsx` | Floating card, icon buttons, Escape shortcut |
| `extension/webview/components/ToolCallRow.tsx` | New component |
| `extension/webview/hooks/useChat.ts` | Extract tool calls into parallel state |
| `extension/webview/vscode.ts` | Ensure `acquireVsCodeApi` export |

---

## Constraints & Non-goals

- No new npm dependencies at runtime (no `highlight.js` — syntax coloring deferred; the language label in the code block header is sufficient for v1)
- All animations GPU-composited only — no layout-thrashing during streaming
- CSP compliance: no inline event handlers in dynamically generated HTML
- VS Code theme compatibility: 100% `var(--vscode-*)` tokens, zero hardcoded colors
- Server-side code untouched
