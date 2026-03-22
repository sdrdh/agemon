/**
 * Settings stored as ~/.agemon/settings.json.
 * File is small; read whole file on each access, no caching needed.
 */
import { join } from 'path';
import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteJsonSync } from './fs.ts';
import { AGEMON_DIR } from './git.ts';

function getSettingsPath(): string {
  return join(AGEMON_DIR, 'settings.json');
}

function readSettings(): Record<string, string> {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function getSetting(key: string): string | null {
  return readSettings()[key] ?? null;
}

export function setSetting(key: string, value: string): void {
  const settings = readSettings();
  settings[key] = value;
  atomicWriteJsonSync(getSettingsPath(), settings);
}

export function getAllSettings(): Record<string, string> {
  return readSettings();
}
