const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const extensionOpts = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
};

const webviewOpts = {
  entryPoints: ['webview/index.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
};

async function main() {
  // Copy webview HTML template into dist/ so it's available in packaged extension
  fs.mkdirSync('dist', { recursive: true });
  fs.copyFileSync(
    path.join('webview', 'index.html'),
    path.join('dist', 'index.html')
  );

  if (watch) {
    const extCtx = await esbuild.context(extensionOpts);
    const webCtx = await esbuild.context(webviewOpts);
    await extCtx.watch();
    await webCtx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(extensionOpts);
    await esbuild.build(webviewOpts);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
