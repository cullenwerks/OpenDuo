import React, { useState, useEffect } from 'react';
import { ChatWindow } from './ChatWindow';
import { InputBar } from './InputBar';
import { StatusBar } from './StatusBar';
import { useChat } from '../hooks/useChat';

declare const window: Window & { __OPENDUO_SERVER_URL__?: string };

const SERVER_URL = window.__OPENDUO_SERVER_URL__ || 'http://127.0.0.1:8745';

export const ChatApp: React.FC = () => {
  const { messages, isLoading, sendMessage } = useChat(SERVER_URL);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const resp = await fetch(`${SERVER_URL}/health`);
        setConnected(resp.ok);
      } catch {
        setConnected(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 10_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <StatusBar connected={connected} model="claude-sonnet-4-5" />
      <ChatWindow messages={messages} />
      <InputBar onSend={(text) => sendMessage(text)} disabled={isLoading} />
    </div>
  );
};
