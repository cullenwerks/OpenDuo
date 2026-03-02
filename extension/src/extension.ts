import * as vscode from 'vscode';
import * as path from 'path';
import { PatManager } from './patManager';
import { ServerManager } from './server';
import { getOutputChannel, log, logDebug, logError, logInfo, logWarn, showError } from './logger';
import { ChatPanel } from './chatPanel';

let serverManager: ServerManager | null = null;
/** Tracks the env the running server was started with so we can detect changes. */
let activeServerEnv: Record<string, string> = {};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logInfo('OpenDuo activating...');
  logDebug(`Extension path: ${context.extensionPath}`);
  logDebug(`VS Code version: ${vscode.version}`);
  logDebug(`Extension version: ${context.extension.packageJSON.version ?? 'unknown'}`);

  const patManager = new PatManager(context.secrets);
  const serverScript = path.join(context.extensionPath, 'dist', 'server.js');
  logDebug(`Server script path: ${serverScript}`);

  // Register: Configure PAT
  context.subscriptions.push(
    vscode.commands.registerCommand('openduo.configurePat', async () => {
      logInfo('Command: openduo.configurePat');
      const pat = await patManager.prompt();
      if (pat) {
        logInfo('PAT saved successfully');
        vscode.window.showInformationMessage('OpenDuo: PAT saved successfully.');
      } else {
        logInfo('PAT configuration cancelled or not provided');
      }
    })
  );

  // Register: Open Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('openduo.openChat', async () => {
      logInfo('Command: openduo.openChat');

      const pat = await patManager.get();
      if (!pat) {
        logWarn('No PAT configured — prompting user');
        const action = await vscode.window.showWarningMessage(
          'OpenDuo: No PAT configured.',
          'Configure PAT'
        );
        if (action === 'Configure PAT') {
          await vscode.commands.executeCommand('openduo.configurePat');
        }
        return;
      }

      const cfg = vscode.workspace.getConfiguration('openduo');
      const gitlabUrl = cfg.get<string>('gitlabUrl', '');
      if (!gitlabUrl) {
        logError('openduo.gitlabUrl is not set');
        vscode.window.showErrorMessage('OpenDuo: Set openduo.gitlabUrl in settings.');
        return;
      }
      logDebug(`GitLab URL: ${gitlabUrl}`);

      const chatProvider = cfg.get<string>('chatProvider', 'rest');
      logDebug(`Chat provider: ${chatProvider}`);

      // Log proxy configuration for diagnostics
      const httpCfg = vscode.workspace.getConfiguration('http');
      const vscodeProxy = httpCfg.get<string>('proxy') ?? '';
      if (vscodeProxy) {
        logInfo(`VS Code http.proxy setting: ${vscodeProxy}`);
      } else {
        logDebug('No VS Code http.proxy setting configured');
      }

      // Collect open workspace folders
      const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => ({
        name: f.name,
        path: f.uri.fsPath,
      }));
      logDebug(`Workspace folders: ${workspaceFolders.map(f => f.name).join(', ') || '(none)'}`);

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
        logInfo('Settings changed — restarting server');
        await serverManager.stop();
        serverManager = null;
      }

      if (!serverManager || !serverManager.isRunning()) {
        logInfo('Starting OpenDuo server...');
        try {
          serverManager = new ServerManager(serverScript, desiredEnv);
          activeServerEnv = desiredEnv;
          await serverManager.start(getOutputChannel());
          serverManager.setIpcHandler(async (method: string, params: Record<string, unknown>) => {
            logDebug(`IPC handler: method=${method}`);
            switch (method) {
              case 'getDiagnostics':
                return handleGetDiagnostics(params);
              case 'getEditorContext':
                return handleGetEditorContext();
              default:
                logError(`Unknown IPC method: ${method}`);
                throw new Error(`Unknown IPC method: ${method}`);
            }
          });
        } catch (err) {
          logError('Failed to start OpenDuo server', err);
          showError('OpenDuo: Failed to start server', err);
          serverManager = null;
          return;
        }
      }

      logInfo(`Server running at ${serverManager.serverUrl()}`);
      ChatPanel.createOrShow(context.extensionUri, serverManager.serverUrl());
    })
  );

  context.subscriptions.push({
    dispose: () => {
      logInfo('OpenDuo deactivating — stopping server');
      serverManager?.stop();
    }
  });

  logInfo('OpenDuo activated.');
}

function handleGetDiagnostics(params: Record<string, unknown>): Array<Record<string, unknown>> {
  const filterPath = params.filePath as string | undefined;
  const filterSeverity = params.severity as string | undefined;
  logDebug(`handleGetDiagnostics: filterPath=${filterPath ?? '*'} filterSeverity=${filterSeverity ?? '*'}`);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const allDiagnostics = vscode.languages.getDiagnostics();
  const results: Array<Record<string, unknown>> = [];
  const MAX_RESULTS = 100;

  const severityMap: Record<number, string> = {
    0: 'error',
    1: 'warning',
    2: 'info',
    3: 'hint',
  };

  for (const [uri, diagnostics] of allDiagnostics) {
    if (results.length >= MAX_RESULTS) break;

    const absPath = uri.fsPath;
    const relPath = workspaceRoot
      ? path.relative(workspaceRoot, absPath).replace(/\\/g, '/')
      : absPath;

    if (filterPath && relPath !== filterPath) continue;

    for (const d of diagnostics) {
      if (results.length >= MAX_RESULTS) break;

      const sev = severityMap[d.severity] ?? 'info';
      if (filterSeverity && sev !== filterSeverity) continue;

      results.push({
        file: relPath,
        line: d.range.start.line + 1,
        column: d.range.start.character,
        severity: sev,
        message: d.message,
        source: d.source ?? '',
      });
    }
  }

  logDebug(`handleGetDiagnostics: returning ${results.length} results`);
  return results;
}

function handleGetEditorContext(): Record<string, unknown> | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    logDebug('handleGetEditorContext: no active editor');
    return null;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const absPath = editor.document.uri.fsPath;
  const filePath = workspaceRoot
    ? path.relative(workspaceRoot, absPath).replace(/\\/g, '/')
    : absPath;

  logDebug(`handleGetEditorContext: file=${filePath} lang=${editor.document.languageId}`);

  const sel = editor.selection;
  const selectedText = editor.document.getText(sel);

  return {
    filePath,
    languageId: editor.document.languageId,
    selection: selectedText.slice(0, 10240),
    selectionRange: {
      startLine: sel.start.line + 1,
      startCol: sel.start.character,
      endLine: sel.end.line + 1,
      endCol: sel.end.character,
    },
    visibleRange: {
      startLine: (editor.visibleRanges[0]?.start.line ?? 0) + 1,
      endLine: (editor.visibleRanges[0]?.end.line ?? 0) + 1,
    },
    isDirty: editor.document.isDirty,
    lineCount: editor.document.lineCount,
  };
}

export function deactivate(): void {
  logInfo('OpenDuo deactivating');
  serverManager?.stop();
}
