import { buildExtensionRenderers } from '../../shared/extension-build.ts';
await buildExtensionRenderers(import.meta.dir, 'memory-cms');
