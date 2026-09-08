import { createPool } from '../../src/index.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://orders:orders_dev@127.0.0.1:5432/orders_test';

export function createTestPool() {
  return createPool({ connectionString: TEST_DATABASE_URL, max: 4 });
}

export async function resetDatabase(pool) {
  await pool.query('TRUNCATE TABLE orders, products CASCADE');
}
