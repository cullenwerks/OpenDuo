import { useState, useCallback, useRef } from 'react';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  isStreaming?: boolean;
}

export function createMessage(role: MessageRole, content: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content };
}

export function appendToken(msg: ChatMessage, token: string): ChatMessage {
  return { ...msg, content: msg.content + token };
}

export function useChat(serverUrl: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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

    try {
      const resp = await fetch(`${serverUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
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

      // BUG FIX: Use a buffer to accumulate partial lines across chunks.
      // Previously, if a "data: some text" line was split across two network
      // chunks, the second half would be lost.  Now we keep a buffer and only
      // process complete lines (those followed by '\n').
      let buffer = '';
      let done = false;

      while (!done) {
        const result = await reader.read();
        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true });

        const lines = buffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);

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

          setMessages(prev => prev.map(m =>
            m.id === assistantMsg.id
              ? appendToken(m, data)
              : m
          ));
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
    }
  }, [serverUrl, cancelRequest]);

  const resetChat = useCallback(async () => {
    cancelRequest();
    setMessages([]);
    setIsLoading(false);
    try {
      await fetch(`${serverUrl}/chat/reset`, { method: 'POST' });
    } catch {
      // Server reset is best-effort; UI is already cleared
    }
  }, [serverUrl, cancelRequest]);

  return { messages, isLoading, sendMessage, cancelRequest, resetChat };
}
