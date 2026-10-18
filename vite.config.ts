import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Records which files went into the editor bundle; scripts/build-agent.mjs lists their packages in the license notices. */
export const WEB_MODULES = 'node_modules/.cache/cvslate/web-modules.json';
const bundledModules = (): Plugin => ({
  name: 'bundled-modules',
  apply: 'build',
  generateBundle(_options, bundle) {
    const ids = Object.values(bundle).flatMap((item) => (item.type === 'chunk' ? item.moduleIds : []));
    mkdirSync('node_modules/.cache/cvslate', { recursive: true });
    writeFileSync(WEB_MODULES, JSON.stringify(ids));
  },
});

export default defineConfig({
  plugins: [react(), bundledModules()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
});
