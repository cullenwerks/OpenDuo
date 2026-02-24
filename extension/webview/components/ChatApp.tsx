import React from 'react';
import { ChatWindow } from './ChatWindow';
import { InputBar } from './InputBar';
import { StatusBar } from './StatusBar';
import { useChat } from '../hooks/useChat';

const SERVER_URL = 'http://127.0.0.1:8745';

export const ChatApp: React.FC = () => {
  const { messages, isLoading, sendMessage } = useChat(SERVER_URL);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <StatusBar connected={true} model="claude-sonnet-4-5" />
      <ChatWindow messages={messages} />
      <InputBar onSend={(text) => sendMessage(text, 'user')} disabled={isLoading} />
    </div>
  );
};
