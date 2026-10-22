import { readFile } from 'node:fs/promises';
import path from 'node:path';
// `import css from './theme.css?raw'` as in Vite: the CLI ships the built-in theme stylesheets for `lulicv theme new`.
export const rawPlugin = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
      namespace: 'raw',
    }));
    build.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};
