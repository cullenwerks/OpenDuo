import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { log } from './logger';

export class ChatPanel {
  private static instance: ChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly serverUrl: string;

  private constructor(
    extensionUri: vscode.Uri,
    serverUrl: string,
  ) {
    this.serverUrl = serverUrl;
    this.panel = vscode.window.createWebviewPanel(
      'openduoChat',
      'OpenDuo',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist'),
        ],
      }
    );

    this.panel.webview.html = this.buildHtml(extensionUri);
    this.panel.onDidDispose(() => { ChatPanel.instance = undefined; });
    log(`ChatPanel opened, serverUrl=${serverUrl}`);
  }

  static createOrShow(extensionUri: vscode.Uri, serverUrl: string): void {
    if (ChatPanel.instance) {
      ChatPanel.instance.panel.reveal();
      return;
    }
    ChatPanel.instance = new ChatPanel(extensionUri, serverUrl);
  }

  private buildHtml(extensionUri: vscode.Uri): string {
    const nonce = this.getNonce();
    const webviewUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js')
    );
    const htmlPath = path.join(extensionUri.fsPath, 'webview', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/\$\{cspNonce\}/g, nonce);
    html = html.replace('${webviewUri}', webviewUri.toString());
    return html;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
