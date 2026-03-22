// Settings are now stored in ~/.agemon/settings.json.
// All functions delegate to settings-store.ts; callers are unchanged.
export { getSetting, setSetting, getAllSettings } from '../lib/settings-store.ts';
