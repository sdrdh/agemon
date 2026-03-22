/**
 * Build script for voice-input plugin renderers.
 * Same pattern as plugins/tasks/build.ts.
 */
import { readdir, mkdir } from 'fs/promises';
import { join } from 'path';

const RENDERERS_DIR = join(import.meta.dir, 'renderers');
const OUT_DIR = join(import.meta.dir, 'dist', 'renderers');

const EXTERNAL_MAP: Record<string, string> = {
  'react': 'React',
  'react/jsx-runtime': 'jsxRuntime',
  'react/jsx-dev-runtime': 'jsxRuntime',
  'react-dom': 'ReactDOM',
  'lucide-react': 'LucideReact',
};

const agemonExternalsPlugin: import('bun').BunPlugin = {
  name: 'agemon-externals',
  setup(build) {
    const pattern = new RegExp(
      `^(${Object.keys(EXTERNAL_MAP).map(k => k.replace(/\//g, '\\/')).join('|')})$`
    );
    build.onResolve({ filter: pattern }, (args) => ({
      path: args.path,
      namespace: 'agemon-ext',
    }));
    build.onLoad({ filter: /.*/, namespace: 'agemon-ext' }, (args) => ({
      contents: `module.exports = window.__AGEMON__.${EXTERNAL_MAP[args.path]};`,
      loader: 'js',
    }));
  },
};

const files = (await readdir(RENDERERS_DIR)).filter(f => f.endsWith('.tsx'));
if (files.length === 0) {
  console.info('[voice-input] no renderers to build');
  process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });

const result = await Bun.build({
  entrypoints: files.map(f => join(RENDERERS_DIR, f)),
  outdir: OUT_DIR,
  format: 'esm',
  target: 'browser',
  minify: false,
  plugins: [agemonExternalsPlugin],
});

if (!result.success) {
  console.error('[voice-input] build failed:');
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.info(`[voice-input] built ${result.outputs.length} renderer(s)`);
