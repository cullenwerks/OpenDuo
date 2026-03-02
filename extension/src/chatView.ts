import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { logInfo, logDebug } from './logger';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);
    logInfo('ChatViewProvider: webview resolved');

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'openCode') {
        logDebug(`ChatViewProvider: openCode received, language=${msg.language}`);
        try {
          const doc = await vscode.workspace.openTextDocument({
            content: msg.code as string,
            language: (msg.language as string) ?? 'plaintext',
          });
          await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Active,
          });
        } catch (err) {
          logDebug(`ChatViewProvider: openCode failed: ${(err as Error).message}`);
        }
      }
    });
  }

  focus(): void {
    this._view?.show(true);
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const webviewUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
    );
    const htmlPath = path.join(this.extensionUri.fsPath, 'dist', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/\$\{cspNonce\}/g, nonce);
    html = html.replace('${webviewUri}', webviewUri.toString());
    html = html.replace('${serverUrl}', 'http://127.0.0.1:8745');
    return html;
  }
}
