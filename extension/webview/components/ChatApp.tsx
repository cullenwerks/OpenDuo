import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChatWindow } from './ChatWindow';
import { InputBar } from './InputBar';
import { StatusBar } from './StatusBar';
import { useChat } from '../hooks/useChat';

declare const window: Window & { __OPENDUO_SERVER_URL__?: string };

const SERVER_URL = window.__OPENDUO_SERVER_URL__ || 'http://127.0.0.1:8745';

export const ChatApp: React.FC = () => {
  const [connected, setConnected] = useState(false);
  const [workspaceFolders, setWorkspaceFolders] = useState<string[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | undefined>();
  const activeFolderRef = useRef<string | undefined>();

  // Keep ref in sync so the closure in useChat always reads the latest value
  activeFolderRef.current = activeFolder;
  const getActiveFolder = useCallback(() => activeFolderRef.current, []);

  const { messages, isLoading, sendMessage, cancelRequest, resetChat } = useChat(SERVER_URL, getActiveFolder);

  // Fetch workspace folders from server
  useEffect(() => {
    const fetchWorkspaces = async () => {
      try {
        const resp = await fetch(`${SERVER_URL}/workspaces`);
        if (resp.ok) {
          const data = await resp.json();
          setWorkspaceFolders(data.folders ?? []);
          if (data.active && !activeFolder) {
            setActiveFolder(data.active);
          }
        }
      } catch {
        // Server not ready yet
      }
    };
    fetchWorkspaces();
  }, []);

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
      <StatusBar
        connected={connected}
        model="GitLab Duo (Agentic)"
        onNewChat={resetChat}
        showNewChat={messages.length > 0}
        workspaceFolders={workspaceFolders}
        activeFolder={activeFolder}
        onFolderChange={setActiveFolder}
      />
      <ChatWindow
        messages={messages}
        isLoading={isLoading}
        onExampleClick={(text) => sendMessage(text)}
      />
      <InputBar
        onSend={(text) => sendMessage(text)}
        onCancel={cancelRequest}
        disabled={isLoading}
        showCancel={isLoading}
      />
    </div>
  );
};
