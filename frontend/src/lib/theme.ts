export type ThemeId =
  | 'monochrome-stealth'
  | 'cyber-indigo'
  | 'terminal-green'
  | 'graphite-line-indigo'
  | 'dracula'
  | 'one-dark-pro';

export type ColorMode = 'light' | 'dark' | 'system';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  darkOnly: boolean;
  /** Preview colors for the swatch card (dark variant) */
  preview: { bg: string; primary: string };
}

export const THEMES: ThemeDefinition[] = [
  { id: 'monochrome-stealth', name: 'Monochrome Stealth', darkOnly: false, preview: { bg: '#09090b', primary: '#fafafa' } },
  { id: 'cyber-indigo', name: 'Cyber Indigo', darkOnly: false, preview: { bg: '#0f172a', primary: '#818cf8' } },
  { id: 'terminal-green', name: 'Terminal Green', darkOnly: true, preview: { bg: '#09090b', primary: '#10b981' } },
  { id: 'graphite-line-indigo', name: 'Graphite Line', darkOnly: false, preview: { bg: '#070810', primary: '#4f46e5' } },
  { id: 'dracula', name: 'Dracula', darkOnly: true, preview: { bg: '#282a36', primary: '#8be9fd' } },
  { id: 'one-dark-pro', name: 'One Dark Pro', darkOnly: true, preview: { bg: '#282c34', primary: '#61afef' } },
];

const STORAGE_THEME_KEY = 'agemon_theme';
const STORAGE_MODE_KEY = 'agemon_color_mode';

export function getStoredTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_THEME_KEY);
  if (stored && THEMES.some((t) => t.id === stored)) return stored as ThemeId;
  return 'monochrome-stealth';
}

export function getStoredColorMode(): ColorMode {
  const stored = localStorage.getItem(STORAGE_MODE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'dark';
}

export function storeTheme(themeId: ThemeId) {
  localStorage.setItem(STORAGE_THEME_KEY, themeId);
}

export function storeColorMode(mode: ColorMode) {
  localStorage.setItem(STORAGE_MODE_KEY, mode);
}

export function getThemeDef(id: ThemeId): ThemeDefinition {
  return THEMES.find((t) => t.id === id)!;
}

/** Apply theme + color mode to the document element */
export function applyTheme(themeId: ThemeId, colorMode: ColorMode) {
  const root = document.documentElement;
  const def = getThemeDef(themeId);

  // Set data-theme attribute (monochrome-stealth uses no data-theme, just root defaults)
  if (themeId === 'monochrome-stealth') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', themeId);
  }

  // Resolve effective dark/light
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveDark = def.darkOnly ? true : colorMode === 'dark' || (colorMode === 'system' && prefersDark);

  if (effectiveDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}
