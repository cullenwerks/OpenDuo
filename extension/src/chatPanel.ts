import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { log } from './logger';

export class ChatPanel {
  private static instance: ChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(
    extensionUri: vscode.Uri,
    serverUrl: string,
  ) {
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

    this.panel.webview.html = this.buildHtml(extensionUri, serverUrl);
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

  private buildHtml(extensionUri: vscode.Uri, serverUrl: string): string {
    const nonce = this.getNonce();
    const webviewUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js')
    );
    const htmlPath = path.join(extensionUri.fsPath, 'dist', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/\$\{cspNonce\}/g, nonce);
    html = html.replace('${webviewUri}', webviewUri.toString());
    html = html.replace('${serverUrl}', serverUrl);
    return html;
  }

  private getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}
