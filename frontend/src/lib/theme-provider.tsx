import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  type ThemeId,
  type ColorMode,
  getStoredTheme,
  getStoredColorMode,
  storeTheme,
  storeColorMode,
  applyTheme,
  getThemeDef,
} from './theme';

interface ThemeContextValue {
  themeId: ThemeId;
  colorMode: ColorMode;
  setTheme: (id: ThemeId) => void;
  setColorMode: (mode: ColorMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(getStoredTheme);
  const [colorMode, setColorModeState] = useState<ColorMode>(getStoredColorMode);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id);
    storeTheme(id);
    // If switching to a dark-only theme, force dark mode
    const def = getThemeDef(id);
    if (def.darkOnly) {
      setColorModeState('dark');
      storeColorMode('dark');
    }
  }, []);

  const setColorMode = useCallback((mode: ColorMode) => {
    setColorModeState(mode);
    storeColorMode(mode);
  }, []);

  // Apply theme whenever themeId or colorMode changes
  useEffect(() => {
    applyTheme(themeId, colorMode);
  }, [themeId, colorMode]);

  // Listen for system color scheme changes when mode is 'system'
  useEffect(() => {
    if (colorMode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme(themeId, colorMode);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [themeId, colorMode]);

  return (
    <ThemeContext.Provider value={{ themeId, colorMode, setTheme, setColorMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
