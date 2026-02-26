import * as vscode from 'vscode';
import * as path from 'path';
import { PatManager } from './patManager';
import { ServerManager } from './server';
import { getOutputChannel, log } from './logger';
import { ChatPanel } from './chatPanel';

let serverManager: ServerManager | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('OpenDuo activating...');

  const patManager = new PatManager(context.secrets);
  const binaryPath = path.join(context.extensionPath, 'bin', 'openduo-server.exe');

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
      // Read setting at command time so changes are picked up without restart
      const gitlabUrl = vscode.workspace.getConfiguration('openduo').get<string>('gitlabUrl', '');
      if (!gitlabUrl) {
        vscode.window.showErrorMessage('OpenDuo: Set openduo.gitlabUrl in settings.');
        return;
      }
      if (!serverManager || !serverManager.isRunning()) {
        serverManager = new ServerManager(binaryPath, {
          GITLAB_URL: gitlabUrl,
          GITLAB_PAT: pat,
        });
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
