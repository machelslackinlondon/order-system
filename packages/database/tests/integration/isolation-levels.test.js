import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { createProductRepository, withTransaction } from '../../src/index.js';
import { createTestPool, resetDatabase } from './test-database.js';

function createSignal() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });

  return { promise, resolve };
}

function createBarrier(parties) {
  const released = createSignal();
  let arrivals = 0;

  return async function arrive() {
    arrivals += 1;
    if (arrivals === parties) {
      released.resolve();
    }
    await released.promise;
  };
}

describe('PostgreSQL transaction isolation levels', () => {
  let pool;
  let products;

  beforeAll(() => {
    pool = createTestPool();
    products = createProductRepository(pool);
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createProduct(stock = 5) {
    return products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock,
      version: 1,
    });
  }

  async function readStock(client, productId) {
    const result = await client.query('SELECT stock FROM products WHERE id = $1', [productId]);
    return result.rows[0].stock;
  }

  async function readAroundCommittedUpdate(isolationLevel) {
    const product = await createProduct();
    const firstReadCompleted = createSignal();
    const updateCommitted = createSignal();

    const reads = withTransaction(
      pool,
      async (client) => {
        const first = await readStock(client, product.id);
        firstReadCompleted.resolve();
        await updateCommitted.promise;
        const second = await readStock(client, product.id);
        return [first, second];
      },
      { isolationLevel },
    );

    await firstReadCompleted.promise;
    try {
      await pool.query('UPDATE products SET stock = 3 WHERE id = $1', [product.id]);
    } finally {
      updateCommitted.resolve();
    }

    return { product, reads: await reads };
  }

  it('READ COMMITTED allows a non-repeatable read after another transaction commits', async () => {
    const { reads } = await readAroundCommittedUpdate('READ COMMITTED');

    expect(reads).toEqual([5, 3]);
  });

  it('REPEATABLE READ keeps the original snapshot after another transaction commits', async () => {
    const { product, reads } = await readAroundCommittedUpdate('REPEATABLE READ');

    expect(reads).toEqual([5, 5]);
    await expect(products.findById(product.id)).resolves.toMatchObject({ stock: 3 });
  });

  it('SERIALIZABLE rejects one of two updates based on the same snapshot', async () => {
    const product = await createProduct();
    const bothTransactionsRead = createBarrier(2);

    const updateFromSnapshot = () =>
      withTransaction(
        pool,
        async (client) => {
          const stock = await readStock(client, product.id);
          await bothTransactionsRead();
          await client.query('UPDATE products SET stock = $2 WHERE id = $1', [
            product.id,
            stock - 1,
          ]);
          return stock - 1;
        },
        { isolationLevel: 'SERIALIZABLE' },
      );

    const outcomes = await Promise.allSettled([updateFromSnapshot(), updateFromSnapshot()]);
    const fulfilled = outcomes.filter(({ status }) => status === 'fulfilled');
    const rejected = outcomes.filter(({ status }) => status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].value).toBe(4);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: '40001' });
    await expect(products.findById(product.id)).resolves.toMatchObject({ stock: 4 });
  });
});
