import * as cp from 'child_process';
import * as vscode from 'vscode';

const DEFAULT_PORT = 8745;

export class ServerManager {
  private process: cp.ChildProcess | null = null;
  private readonly port: number;
  private outputChannel: vscode.OutputChannel | null = null;

  constructor(
    private readonly binaryPath: string,
    private readonly env: Record<string, string>,
    port: number = DEFAULT_PORT
  ) {
    this.port = port;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  serverUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(outputChannel: vscode.OutputChannel): Promise<void> {
    if (this.isRunning()) return;
    this.outputChannel = outputChannel;

    this.process = cp.spawn(this.binaryPath, [], {
      env: {
        ...process.env,
        ...this.env,
        OPENDUO_PORT: String(this.port),
        RUST_LOG: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (d: Buffer) => outputChannel.append(d.toString()));
    this.process.stderr?.on('data', (d: Buffer) => outputChannel.append(d.toString()));
    this.process.on('exit', (code) => {
      outputChannel.appendLine(`[OpenDuo] Server exited with code ${code}`);
      this.process = null;
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
