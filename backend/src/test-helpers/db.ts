/**
 * Setup test database — no-op now that SQLite is gone.
 * Kept for test compatibility.
 */
export function setupTestDb(): void {
  // No on-disk SQLite to reset. All stores are in-memory.
}
