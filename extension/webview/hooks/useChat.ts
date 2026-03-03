import { useState, useCallback, useRef } from 'react';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  isStreaming?: boolean;
}

export interface PendingConfirmation {
  id: string;
  command: string;
}

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

export function createMessage(role: MessageRole, content: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content };
}

export function appendToken(msg: ChatMessage, token: string): ChatMessage {
  return { ...msg, content: msg.content + token };
}

export function useChat(serverUrl: string, getActiveFolder?: () => string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);

  const cancelRequest = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    // Cancel any in-flight request before starting a new one
    cancelRequest();

    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg = createMessage('user', text);
    const assistantMsg: ChatMessage = { ...createMessage('assistant', ''), isStreaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);
    setToolCalls([]);

    try {
      const resp = await fetch(`${serverUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, workspaceFolder: getActiveFolder?.() }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => 'Unknown error');
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: `Error: ${resp.status} ${errorText}`, isStreaming: false }
            : m
        ));
        return;
      }

      if (!resp.body) {
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: 'Error: No response body', isStreaming: false }
            : m
        ));
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();

      // SSE events are delimited by blank lines (\n\n).  Buffer incoming
      // chunks and process complete events so that multi-line tokens
      // (tokens containing \n emitted by the server as multiple data: fields
      // within one event) are reassembled correctly before dispatch.
      let buffer = '';
      let done = false;
      const EVENT_DELIMITER = '\n\n';

      while (!done) {
        const result = await reader.read();
        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true });

        // Drain all complete events from the buffer
        let eventEnd: number;
        while ((eventEnd = buffer.indexOf(EVENT_DELIMITER)) !== -1) {
          const rawEvent = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + EVENT_DELIMITER.length);

          if (!rawEvent.trim()) continue;

          // Per SSE spec: collect all data: fields and join with \n so that
          // tokens containing newlines are faithfully reconstructed.
          const dataLines: string[] = [];
          for (const line of rawEvent.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              dataLines.push(trimmed.slice(6));
            } else if (trimmed === 'data:') {
              // Empty data field represents an empty string (becomes a \n
              // when joined with adjacent data fields).
              dataLines.push('');
            }
          }

          if (dataLines.length === 0) continue;
          const data = dataLines.join('\n');

          if (data === '[DONE]') {
            done = true;
            break;
          }

          if (data.startsWith('[ERROR] ')) {
            setMessages(prev => prev.map(m =>
              m.id === assistantMsg.id
                ? { ...m, content: `Error: ${data.slice(8)}`, isStreaming: false }
                : m
            ));
            done = true;
            break;
          }

          // Check for confirmation request from run_command tool
          const confirmMatch = data.match(/^\n?\[CONFIRM:([\w-]+)\] (.+)\n?$/);
          if (confirmMatch) {
            setPendingConfirmation({ id: confirmMatch[1], command: confirmMatch[2] });
          } else {
            const toolCallMatch = parseToolCallToken(data);
            if (toolCallMatch) {
              // Mark previous running tool call as done before adding new one
              setToolCalls(prev => prev.map(tc =>
                tc.status === 'running' ? { ...tc, status: 'done', endTime: Date.now() } : tc
              ));
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
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Request was intentionally cancelled — don't show an error
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: `Connection error: ${message}`, isStreaming: false }
          : m
      ));
    } finally {
      abortRef.current = null;
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
      ));
      setIsLoading(false);
      setToolCalls(prev => prev.map(tc =>
        tc.status === 'running' ? { ...tc, status: 'done', endTime: Date.now() } : tc
      ));
    }
  }, [serverUrl, cancelRequest]);

  const confirmCommand = useCallback(async (id: string, approved: boolean) => {
    setPendingConfirmation(null);
    try {
      await fetch(`${serverUrl}/command/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, approved }),
      });
    } catch (e) {
      console.error('Failed to send confirmation:', e);
    }
  }, [serverUrl]);

  const resetChat = useCallback(async () => {
    cancelRequest();
    setMessages([]);
    setToolCalls([]);
    setIsLoading(false);
    try {
      await fetch(`${serverUrl}/chat/reset`, { method: 'POST' });
    } catch {
      // Server reset is best-effort; UI is already cleared
    }
  }, [serverUrl, cancelRequest]);

  return { messages, isLoading, sendMessage, cancelRequest, resetChat, pendingConfirmation, confirmCommand, toolCalls };
}
