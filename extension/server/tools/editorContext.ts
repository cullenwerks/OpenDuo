import type { Tool } from './tool';
import { sendIpcRequest } from '../ipcBridge';

export function editorContextTools(): Tool[] {
  return [
    {
      name: 'get_editor_context',
      description:
        "Get the user's current editor context — which file is open, " +
        'what text is selected, cursor position, and visible range. ' +
        'Use this to understand what the user is looking at.',
      parametersSchema: () => ({
        type: 'object',
        properties: {},
      }),
      async execute() {
        try {
          const ctx = await sendIpcRequest('getEditorContext', {});
          if (!ctx) return 'No editor is currently open.';
          return JSON.stringify(ctx, null, 2);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    },
  ];
}
