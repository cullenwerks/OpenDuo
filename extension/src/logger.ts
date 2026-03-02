import * as vscode from 'vscode';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

let channel: vscode.OutputChannel | null = null;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('OpenDuo');
  }
  return channel;
}

function write(level: LogLevel, message: string): void {
  getOutputChannel().appendLine(`[${new Date().toISOString()}] [${level}] ${message}`);
}

/** General info log (backwards-compatible alias for logInfo). */
export function log(message: string): void {
  write('INFO', message);
}

export function logInfo(message: string): void {
  write('INFO', message);
}

export function logDebug(message: string): void {
  write('DEBUG', message);
}

export function logWarn(message: string): void {
  write('WARN', message);
}

/**
 * Log an error with optional Error object or unknown value.
 * Includes stack trace if available.
 */
export function logError(message: string, error?: unknown): void {
  let detail = '';
  if (error instanceof Error) {
    detail = `: ${error.message}`;
    if (error.stack) {
      detail += `\n${error.stack}`;
    }
  } else if (error !== undefined) {
    detail = `: ${String(error)}`;
  }
  write('ERROR', `${message}${detail}`);
}

/**
 * Show an error notification to the user and log it.
 * Use for errors that need user attention.
 */
export function showError(message: string, error?: unknown): void {
  logError(message, error);
  const detail = error instanceof Error ? error.message : '';
  vscode.window.showErrorMessage(detail ? `${message}: ${detail}` : message);
}

/**
 * Show a warning notification to the user and log it.
 */
export function showWarn(message: string): void {
  logWarn(message);
  vscode.window.showWarningMessage(message);
}
