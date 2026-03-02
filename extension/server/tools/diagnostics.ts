import type { Tool } from './tool';
import { sendIpcRequest } from '../ipcBridge';

export function diagnosticsTools(): Tool[] {
  return [
    {
      name: 'get_diagnostics',
      description:
        "Get diagnostics (errors, warnings) from the user's VS Code editor. " +
        'These come from TypeScript, ESLint, and other language tools. ' +
        'Use this to find and fix problems in the code.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Filter to a specific file (relative to workspace root). Omit for all files.',
          },
          severity: {
            type: 'string',
            enum: ['error', 'warning', 'info', 'hint'],
            description: 'Filter by severity level. Omit for all severities.',
          },
        },
      }),
      async execute(args) {
        const filePath = args.file_path as string | undefined;
        const severity = args.severity as string | undefined;

        try {
          const diagnostics = await sendIpcRequest('getDiagnostics', {
            filePath,
            severity,
          });

          const items = diagnostics as Array<Record<string, unknown>>;
          if (!items || items.length === 0) {
            return 'No diagnostics found' +
              (filePath ? ` for ${filePath}` : '') +
              (severity ? ` with severity "${severity}"` : '') +
              '.';
          }

          return JSON.stringify(items, null, 2);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    },
  ];
}
