import * as vscode from 'vscode';
import * as path from 'path';
import { PatManager } from './patManager';
import { ServerManager } from './server';
import { getOutputChannel, log } from './logger';
import { ChatPanel } from './chatPanel';

let serverManager: ServerManager | null = null;
/** Tracks the env the running server was started with so we can detect changes. */
let activeServerEnv: Record<string, string> = {};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('OpenDuo activating...');

  const patManager = new PatManager(context.secrets);
  const serverScript = path.join(context.extensionPath, 'dist', 'server.js');

  // Register: Configure PAT
  context.subscriptions.push(
    vscode.commands.registerCommand('openduo.configurePat', async () => {
      const pat = await patManager.prompt();
      if (pat) {
        vscode.window.showInformationMessage('OpenDuo: PAT saved successfully.');
      }
    })
  );

  // Register: Open Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('openduo.openChat', async () => {
      const pat = await patManager.get();
      if (!pat) {
        const action = await vscode.window.showWarningMessage(
          'OpenDuo: No PAT configured.',
          'Configure PAT'
        );
        if (action === 'Configure PAT') {
          await vscode.commands.executeCommand('openduo.configurePat');
        }
        return;
      }
      // Read settings at command time so changes are picked up without restart
      const cfg = vscode.workspace.getConfiguration('openduo');
      const gitlabUrl = cfg.get<string>('gitlabUrl', '');
      if (!gitlabUrl) {
        vscode.window.showErrorMessage('OpenDuo: Set openduo.gitlabUrl in settings.');
        return;
      }
      const chatProvider = cfg.get<string>('chatProvider', 'rest');

      // Collect open workspace folders so the server can provide local
      // file tools (read, list, search) for agentic workspace access.
      const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => ({
        name: f.name,
        path: f.uri.fsPath,
      }));

      const desiredEnv: Record<string, string> = {
        GITLAB_URL: gitlabUrl,
        GITLAB_PAT: pat,
        OPENDUO_CHAT_PROVIDER: chatProvider,
        OPENDUO_WORKSPACE_FOLDERS: JSON.stringify(workspaceFolders),
      };

      // Restart the server if settings changed since the last launch.
      const envChanged = Object.keys(desiredEnv).some(
        (k) => desiredEnv[k] !== activeServerEnv[k],
      );
      if (envChanged && serverManager?.isRunning()) {
        log('Settings changed — restarting server');
        await serverManager.stop();
        serverManager = null;
      }

      if (!serverManager || !serverManager.isRunning()) {
        serverManager = new ServerManager(serverScript, desiredEnv);
        activeServerEnv = desiredEnv;
        await serverManager.start(getOutputChannel());
      }
      log('Server running at ' + serverManager.serverUrl());
      ChatPanel.createOrShow(context.extensionUri, serverManager.serverUrl());
    })
  );

  context.subscriptions.push({
    dispose: () => { serverManager?.stop(); }
  });

  log('OpenDuo activated.');
}

export function deactivate(): void {
  serverManager?.stop();
}
