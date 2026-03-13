import { resetDb, runMigrations } from '../db/client.ts';

/**
 * Setup test database with in-memory storage.
 * Resets the singleton connection and runs migrations.
 */
export function setupTestDb(): void {
  // Set DB_PATH to :memory: for in-memory testing
  process.env.DB_PATH = ':memory:';

  // Reset the singleton to force re-creation with new path
  resetDb();

  // Run migrations on the in-memory database
  runMigrations();
}
