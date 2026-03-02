import * as cp from 'child_process';
import * as vscode from 'vscode';
import { logDebug, logError, logInfo, logWarn } from './logger';

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
    if (this.isRunning()) {
      logDebug('[ServerManager] start() called but server is already running');
      return;
    }
    this.outputChannel = outputChannel;

    // Resolve proxy from VS Code settings — prefer explicit setting over system proxy.
    // The child process does NOT inherit VS Code's proxy-agent patches, so we must
    // pass the proxy URL explicitly via environment variables.
    const httpCfg = vscode.workspace.getConfiguration('http');
    const vscodeProxy = httpCfg.get<string>('proxy') ?? '';
    const proxyEnv: Record<string, string> = {};
    if (vscodeProxy) {
      proxyEnv['HTTP_PROXY'] = vscodeProxy;
      proxyEnv['HTTPS_PROXY'] = vscodeProxy;
      proxyEnv['http_proxy'] = vscodeProxy;
      proxyEnv['https_proxy'] = vscodeProxy;
      logInfo(`[ServerManager] Proxy configured from VS Code settings: ${vscodeProxy}`);
    } else {
      // Explicitly clear proxy env so child process cannot accidentally inherit
      // the OS/system proxy that VS Code itself may be using.
      proxyEnv['HTTP_PROXY'] = '';
      proxyEnv['HTTPS_PROXY'] = '';
      proxyEnv['http_proxy'] = '';
      proxyEnv['https_proxy'] = '';
      logDebug('[ServerManager] No VS Code proxy configured — clearing proxy env for child process');
    }

    // SSL/TLS settings — enterprise environments may need custom CA certs or
    // the ability to skip certificate validation for self-signed certs.
    const cfg = vscode.workspace.getConfiguration('openduo');
    const rejectUnauthorized = cfg.get<boolean>('rejectUnauthorized', true);
    const customCaCertPath = cfg.get<string>('customCaCertPath', '');
    const tlsEnv: Record<string, string> = {};
    if (!rejectUnauthorized) {
      tlsEnv['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
      tlsEnv['OPENDUO_REJECT_UNAUTHORIZED'] = '0';
      logWarn('[ServerManager] SSL certificate validation DISABLED (openduo.rejectUnauthorized=false)');
    }
    if (customCaCertPath) {
      tlsEnv['NODE_EXTRA_CA_CERTS'] = customCaCertPath;
      tlsEnv['OPENDUO_CA_CERT'] = customCaCertPath;
      logInfo(`[ServerManager] Custom CA certificate: ${customCaCertPath}`);
    }

    // Debug logging flags — each category can be independently enabled
    const debugEnv: Record<string, string> = {};
    const debugKeys: Array<[string, string]> = [
      ['debug.networkErrors', 'OPENDUO_DEBUG_NETWORK'],
      ['debug.sslErrors', 'OPENDUO_DEBUG_SSL'],
      ['debug.proxyErrors', 'OPENDUO_DEBUG_PROXY'],
      ['debug.apiErrors', 'OPENDUO_DEBUG_API'],
      ['debug.webSocketErrors', 'OPENDUO_DEBUG_WEBSOCKET'],
      ['debug.serverErrors', 'OPENDUO_DEBUG_SERVER'],
    ];
    const enabledDebugFlags: string[] = [];
    for (const [settingKey, envKey] of debugKeys) {
      if (cfg.get<boolean>(settingKey, false)) {
        debugEnv[envKey] = '1';
        enabledDebugFlags.push(settingKey);
      }
    }
    if (enabledDebugFlags.length > 0) {
      logInfo(`[ServerManager] Debug logging enabled: ${enabledDebugFlags.join(', ')}`);
    }

    const spawnArgs = [this.scriptPath];
    logInfo(`[ServerManager] Spawning server: ${process.execPath} ${spawnArgs.join(' ')}`);
    logDebug(`[ServerManager] Server env keys: ${Object.keys(this.env).join(', ')}`);
    logDebug(`[ServerManager] Server port: ${this.port}`);

    this.process = cp.spawn(process.execPath, spawnArgs, {
      env: {
        ...process.env,
        ...this.env,
        ...proxyEnv,
        ...tlsEnv,
        ...debugEnv,
        OPENDUO_PORT: String(this.port),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    logInfo(`[ServerManager] Server process spawned (pid=${this.process.pid ?? 'unknown'})`);

    this.process.stdout?.on('data', (d: Buffer) => {
      const text = d.toString();
      outputChannel.append(text);
      logDebug(`[server stdout] ${text.trimEnd()}`);
    });

    this.process.stderr?.on('data', (d: Buffer) => {
      const text = d.toString();
      outputChannel.append(text);
      // Stderr is logged at WARN since it may contain non-fatal diagnostics
      logWarn(`[server stderr] ${text.trimEnd()}`);
    });

    this.process.on('error', (err) => {
      logError('[ServerManager] Failed to spawn server process', err);
      outputChannel.appendLine(`[OpenDuo] Server spawn error: ${err.message}`);
      this.process = null;
    });

    this.process.on('exit', (code, signal) => {
      if (code === 0 || code === null) {
        logInfo(`[ServerManager] Server process exited (code=${code}, signal=${signal})`);
      } else {
        logError(`[ServerManager] Server process exited unexpectedly (code=${code}, signal=${signal})`);
      }
      outputChannel.appendLine(`[OpenDuo] Server exited — code=${code} signal=${signal}`);
      this.process = null;
    });

    this.process.on('message', async (msg: any) => {
      if (msg?.type === 'request' && typeof msg.id === 'string' && typeof msg.method === 'string') {
        logDebug(`[ServerManager] IPC request: method=${msg.method} id=${msg.id}`);
        try {
          const data = this.ipcRequestHandler
            ? await this.ipcRequestHandler(msg.method, msg.params ?? {})
            : null;
          this.process?.send?.({ type: 'response', id: msg.id, data });
          logDebug(`[ServerManager] IPC response sent: id=${msg.id}`);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          logError(`[ServerManager] IPC handler error for method=${msg.method}`, e);
          this.process?.send?.({ type: 'response', id: msg.id, error });
        }
      }
    });

    logInfo('[ServerManager] Waiting for server health check...');
    await this.waitForHealth();
    logInfo(`[ServerManager] Server healthy at ${this.serverUrl()}`);
  }

  async stop(): Promise<void> {
    if (this.process) {
      logInfo(`[ServerManager] Stopping server process (pid=${this.process.pid ?? 'unknown'})`);
      this.process.kill();
      this.process = null;
    }
  }

  private async waitForHealth(timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < timeoutMs) {
      attempt++;
      try {
        const resp = await fetch(`${this.serverUrl()}/health`);
        if (resp.ok) {
          logDebug(`[ServerManager] Health check passed on attempt ${attempt}`);
          return;
        }
        logDebug(`[ServerManager] Health check attempt ${attempt}: HTTP ${resp.status}`);
      } catch (e) {
        logDebug(`[ServerManager] Health check attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`OpenDuo server failed to become healthy within ${timeoutMs}ms (${attempt} attempts)`);
  }
}
