import { useSyncExternalStore } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)';

function subscribeToMediaQuery(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getIsDesktop() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function getIsDesktopServer() {
  return false;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeToMediaQuery, getIsDesktop, getIsDesktopServer);
}
