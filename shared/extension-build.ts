/**
 * Shared build utility for agemon extensions.
 *
 * Usage in each extension's build.ts:
 *   import { buildExtensionRenderers } from '../../shared/extension-build.ts';
 *   await buildExtensionRenderers(import.meta.dir, 'my-extension');
 */
import { readdir, mkdir } from 'fs/promises';
import { join } from 'path';

/** Map bare specifiers to window.__AGEMON__ globals. */
export const EXTERNAL_MAP: Record<string, string> = {
  'react': 'React',
  'react/jsx-runtime': 'jsxRuntime',
  'react/jsx-dev-runtime': 'jsxRuntime',
  'react-dom': 'ReactDOM',
  'lucide-react': 'LucideReact',
  // Agemon host exports — available when the host exposes them via window.__AGEMON__
  '@agemon/ui': 'ui',
  '@agemon/utils': 'utils',
  '@agemon/api': 'api',
  '@agemon/host': 'host',
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
      return {
        contents: `module.exports = window.__AGEMON__.${globalName};`,
        loader: 'js',
      };
    });
  },
};

/**
 * Build all .tsx files in an extension's renderers/ directory to dist/renderers/.
 * Externalizes React, Lucide, and other agemon globals.
 *
 * @param extensionDir - Absolute path to the extension directory (use `import.meta.dir`)
 * @param extensionName - Extension name for log output, e.g. "tasks" or "memory-cms"
 */
export async function buildExtensionRenderers(extensionDir: string, extensionName: string): Promise<void> {
  const renderersDir = join(extensionDir, 'renderers');
  const outDir = join(extensionDir, 'dist', 'renderers');

  let files: string[];
  try {
    files = (await readdir(renderersDir)).filter(f => f.endsWith('.tsx'));
  } catch {
    console.info(`[${extensionName}] no renderers directory, skipping build`);
    process.exit(0);
  }

  if (files.length === 0) {
    console.info(`[${extensionName}] no renderers to build`);
    process.exit(0);
  }

  await mkdir(outDir, { recursive: true });

  const entrypoints = files.map(f => join(renderersDir, f));

  const result = await Bun.build({
    entrypoints,
    outdir: outDir,
    format: 'esm',
    target: 'browser',
    minify: false,
    plugins: [agemonExternalsPlugin],
  });

  if (!result.success) {
    console.error(`[${extensionName}] build failed:`);
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  console.info(`[${extensionName}] built ${result.outputs.length} renderer(s)`);
}
