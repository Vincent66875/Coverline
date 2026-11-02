// Sandbox-only: bundle the Forge page with a mocked @forge/bridge into .check-forge/ for headless checks.
import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
mkdirSync('.check-forge', { recursive: true });
await build({
  entryPoints: ['static/team-map/src/main.jsx'],
  bundle: true,
  outfile: '.check-forge/bundle.js',
  format: 'esm',
  jsx: 'automatic',
  nodePaths: ['/opt/npm-tools/node_modules'],
  alias: { '@forge/bridge': fileURLToPath(new URL('../test/mocks/bridge.js', import.meta.url)) },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
writeFileSync('.check-forge/index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="bundle.css"><title>check</title></head><body style="margin:0"><div id="root"></div><script type="module" src="bundle.js"></script></body></html>');
console.log('bundled .check-forge/');
