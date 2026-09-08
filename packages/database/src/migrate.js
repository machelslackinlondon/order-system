import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

export function migrateDatabase(databaseUrl) {
  if (!databaseUrl) {
    throw new TypeError('databaseUrl is required');
  }

  return runner({
    count: Infinity,
    databaseUrl,
    direction: 'up',
    dir: migrationsDirectory,
    migrationsTable: 'pgmigrations',
    verbose: false,
  });
}
