import { createApp, type AppContext } from '../app.ts';

/**
 * Setup test app with in-memory database for route testing.
 * Use app.request() to test routes without starting a server.
 */
export function setupTestApp(): AppContext {
  return createApp({ key: 'test-key' });
}
