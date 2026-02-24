// Minimal vscode mock for unit tests
export const window = {
  showInputBox: async () => undefined,
  showErrorMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  createWebviewPanel: () => ({}),
  createOutputChannel: () => ({
    append: () => {},
    appendLine: () => {},
    show: () => {},
    dispose: () => {},
  }),
};

export const workspace = {
  getConfiguration: () => ({
    get: (_key: string, defaultValue?: unknown) => defaultValue ?? '',
  }),
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => undefined,
};

export const Uri = {
  file: (p: string) => ({ fsPath: p }),
  parse: (s: string) => ({ toString: () => s }),
};

export class EventEmitter {
  event = () => ({ dispose: () => {} });
  fire() {}
  dispose() {}
}

export enum ViewColumn { One = 1 }
