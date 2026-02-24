import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    alias: {
      vscode: path.resolve(__dirname, '__mocks__/vscode.ts'),
    },
  },
});
