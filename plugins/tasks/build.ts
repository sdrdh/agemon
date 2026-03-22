import { buildPluginRenderers } from '../../shared/plugin-build.ts';
await buildPluginRenderers(import.meta.dir, 'tasks');
