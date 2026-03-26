import { readdir, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';

export type FsEntry = {
  name: string;
  type: 'file' | 'dir';
  path: string;       // relative to the root passed to readFsTree
  size?: number;      // files only
  children?: FsEntry[]; // dirs only, populated when depth > 0
};

const EXCLUDE = new Set(['.git', 'node_modules', 'dist', '.cache']);

export async function readFsTree(root: string, relPath: string, depth: number): Promise<FsEntry[]> {
  // Resolve root once at the top level and pass through to avoid repeated syscalls
  const resolvedRoot = resolve(root);
  return _readFsTree(resolvedRoot, relPath, depth);
}

async function _readFsTree(resolvedRoot: string, relPath: string, depth: number): Promise<FsEntry[]> {
  const abs = resolve(join(resolvedRoot, relPath));

  // Traversal guard: resolved path must be root itself or a descendant
  if (abs !== resolvedRoot && !abs.startsWith(resolvedRoot + '/')) {
    throw new Error('Path traversal detected');
  }

  let dirents;
  try {
    dirents = await readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: FsEntry[] = [];
  const dirPromises: Promise<FsEntry>[] = [];

  for (const entry of dirents) {
    if (EXCLUDE.has(entry.name)) continue;
    const entryAbs = join(abs, entry.name);
    const entryRel = relative(resolvedRoot, entryAbs);

    if (entry.isDirectory()) {
      const fsEntry: FsEntry = { name: entry.name, type: 'dir', path: entryRel };
      if (depth > 0) {
        dirPromises.push(
          _readFsTree(resolvedRoot, entryRel, depth - 1).then(children => {
            fsEntry.children = children;
            return fsEntry;
          })
        );
      } else {
        dirPromises.push(Promise.resolve(fsEntry));
      }
    } else if (entry.isFile()) {
      files.push({ name: entry.name, type: 'file', path: entryRel });
    }
  }

  // Stat all files and resolve all subdirs in parallel
  const [dirs, sizes] = await Promise.all([
    Promise.all(dirPromises),
    Promise.all(files.map(f => stat(join(abs, f.name)).then(s => s.size).catch(() => undefined))),
  ]);

  sizes.forEach((size, i) => { if (size !== undefined) files[i].size = size; });

  const result = [...dirs, ...files];
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}
