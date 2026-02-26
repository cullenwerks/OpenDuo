import { useState, useCallback } from 'react';

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

  const sendMessage = useCallback(async (text: string) => {
    const userMsg = createMessage('user', text);
    const assistantMsg: ChatMessage = { ...createMessage('assistant', ''), isStreaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);

    try {
      const resp = await fetch(`${serverUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
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
      let done = false;

      while (!done) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = decoder.decode(result.value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
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
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: `Connection error: ${message}`, isStreaming: false }
          : m
      ));
    } finally {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
      ));
      setIsLoading(false);
    }
  }, [serverUrl]);

  return { messages, isLoading, sendMessage };
}
