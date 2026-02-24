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

  const sendMessage = useCallback(async (text: string, username: string) => {
    const userMsg = createMessage('user', text);
    const assistantMsg: ChatMessage = { ...createMessage('assistant', ''), isStreaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);

    try {
      const resp = await fetch(`${serverUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, username }),
      });

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            setMessages(prev => prev.map(m =>
              m.id === assistantMsg.id
                ? appendToken(m, data)
                : m
            ));
          }
        }
      }
    } finally {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
      ));
      setIsLoading(false);
    }
  }, [serverUrl]);

  return { messages, isLoading, sendMessage };
}
