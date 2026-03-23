import { writeFileSync, renameSync, mkdirSync } from 'node:fs';

export function atomicWriteSync(path: string, data: string): void {
  const tmp = path + '.tmp';
  writeFileSync(tmp, data, 'utf-8');
  renameSync(tmp, path); // atomic on POSIX
}

export function atomicWriteJsonSync(path: string, obj: unknown): void {
  atomicWriteSync(path, JSON.stringify(obj, null, 2));
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}
