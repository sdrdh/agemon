/**
 * Build script for tasks plugin renderers.
 *
 * Uses Bun.build to transpile TSX → browser-ready ESM JS.
 * React/lucide-react are externalized and mapped to window.__AGEMON__ globals
 * which the host app provides.
 */
import { readdir, mkdir } from 'fs/promises';
import { join } from 'path';

const RENDERERS_DIR = join(import.meta.dir, 'renderers');
const OUT_DIR = join(import.meta.dir, 'dist', 'renderers');

// Map bare specifiers to window.__AGEMON__ globals
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

    build.onLoad({ filter: /.*/, namespace: 'agemon-ext' }, (args) => {
      const globalName = EXTERNAL_MAP[args.path];
      // Emit a CJS module that esbuild/Bun will inline into the ESM bundle.
      // This makes `import { useState } from "react"` resolve to
      // `const { useState } = window.__AGEMON__.React` in the output.
      return {
        contents: `module.exports = window.__AGEMON__.${globalName};`,
        loader: 'js',
      };
    });
  },
};

// Find all .tsx files in renderers/
const files = (await readdir(RENDERERS_DIR)).filter(f => f.endsWith('.tsx'));
if (files.length === 0) {
  console.info('[tasks] no renderers to build');
  process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });

const entrypoints = files.map(f => join(RENDERERS_DIR, f));

const result = await Bun.build({
  entrypoints,
  outdir: OUT_DIR,
  format: 'esm',
  target: 'browser',
  minify: false,
  plugins: [agemonExternalsPlugin],
});

if (!result.success) {
  console.error('[tasks] build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.info(`[tasks] built ${result.outputs.length} renderer(s)`);
