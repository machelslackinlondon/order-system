import { migrateDatabase } from '../src/index.js';

const target = process.argv[2] ?? 'development';
const databaseUrls = {
  development: process.env.DATABASE_URL ?? 'postgresql://orders:orders_dev@127.0.0.1:5432/orders',
  test:
    process.env.TEST_DATABASE_URL ?? 'postgresql://orders:orders_dev@127.0.0.1:5432/orders_test',
};
const databaseUrl = databaseUrls[target];

if (!databaseUrl) {
  throw new Error('Migration target must be development or test');
}

await migrateDatabase(databaseUrl);
