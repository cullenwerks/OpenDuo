import * as cp from 'child_process';
import * as vscode from 'vscode';

const DEFAULT_PORT = 8745;

export class ServerManager {
  private process: cp.ChildProcess | null = null;
  private readonly port: number;
  private outputChannel: vscode.OutputChannel | null = null;
  private ipcRequestHandler: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | null = null;

  constructor(
    private readonly scriptPath: string,
    private readonly env: Record<string, string>,
    port: number = DEFAULT_PORT
  ) {
    this.port = port;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  hasIpc(): boolean {
    return true;
  }

  serverUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  setIpcHandler(handler: (method: string, params: Record<string, unknown>) => Promise<unknown>): void {
    this.ipcRequestHandler = handler;
  }

  async start(outputChannel: vscode.OutputChannel): Promise<void> {
    if (this.isRunning()) return;
    this.outputChannel = outputChannel;

    this.process = cp.spawn(process.execPath, [this.scriptPath], {
      env: {
        ...process.env,
        ...this.env,
        OPENDUO_PORT: String(this.port),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    this.process.stdout?.on('data', (d: Buffer) => outputChannel.append(d.toString()));
    this.process.stderr?.on('data', (d: Buffer) => outputChannel.append(d.toString()));
    this.process.on('exit', (code) => {
      outputChannel.appendLine(`[OpenDuo] Server exited with code ${code}`);
      this.process = null;
    });

    this.process.on('message', async (msg: any) => {
      if (msg?.type === 'request' && typeof msg.id === 'string' && typeof msg.method === 'string') {
        try {
          const data = this.ipcRequestHandler
            ? await this.ipcRequestHandler(msg.method, msg.params ?? {})
            : null;
          this.process?.send?.({ type: 'response', id: msg.id, data });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          this.process?.send?.({ type: 'response', id: msg.id, error });
        }
      }
    });

    await this.waitForHealth();
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private async waitForHealth(timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(`${this.serverUrl()}/health`);
        if (resp.ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('openduo-server failed to start within timeout');
  }
}
