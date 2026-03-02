import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { logInfo, logDebug, logWarn } from './logger';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _onWebviewReady: (() => void) | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Register a callback that fires when the webview panel is first shown. */
  onWebviewReady(cb: () => void): void {
    this._onWebviewReady = cb;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);
    logInfo('ChatViewProvider: webview resolved');

    // Notify the extension host so it can start the server if needed.
    // Fire-and-forget — the webview's health-check polling will detect
    // when the server becomes available.
    if (this._onWebviewReady) {
      this._onWebviewReady();
    }

    const msgDisposable = webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'openCode') {
        if (typeof msg.code !== 'string') {
          logDebug('ChatViewProvider: openCode message missing code field, ignoring');
          return;
        }
        logDebug(`ChatViewProvider: openCode received, language=${msg.language}`);
        try {
          const doc = await vscode.workspace.openTextDocument({
            content: msg.code,
            language: typeof msg.language === 'string' ? msg.language : 'plaintext',
          });
          await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Active,
          });
        } catch (err) {
          logWarn(`ChatViewProvider: openCode failed: ${(err as Error).message}`);
        }
      }
    });
    webviewView.onDidDispose(() => msgDisposable.dispose());
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
