import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { createProductRepository } from '../../src/index.js';
import { createTestPool, resetDatabase } from './test-database.js';

describe('optimistic inventory persistence', () => {
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

  it('reserves available stock and increments its version', async () => {
    const product = await products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock: 10,
      version: 1,
    });

    expect(products.reserveWithVersion).toEqual(expect.any(Function));

    await expect(
      products.reserveWithVersion({
        productId: product.id,
        quantity: 3,
        expectedVersion: 1,
      }),
    ).resolves.toEqual({ ...product, stock: 7, version: 2 });
    await expect(products.findById(product.id)).resolves.toEqual({
      ...product,
      stock: 7,
      version: 2,
    });
  });

  it('leaves inventory unchanged when stock is insufficient', async () => {
    const product = await products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock: 2,
      version: 1,
    });

    expect(products.reserveWithVersion).toEqual(expect.any(Function));

    await expect(
      products.reserveWithVersion({
        productId: product.id,
        quantity: 3,
        expectedVersion: 1,
      }),
    ).resolves.toBeNull();
    await expect(products.findById(product.id)).resolves.toEqual(product);
  });

  it('allows only one concurrent reservation for the same version', async () => {
    const product = await products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock: 10,
      version: 1,
    });

    expect(products.reserveWithVersion).toEqual(expect.any(Function));

    const results = await Promise.all([
      products.reserveWithVersion({
        productId: product.id,
        quantity: 3,
        expectedVersion: 1,
      }),
      products.reserveWithVersion({
        productId: product.id,
        quantity: 3,
        expectedVersion: 1,
      }),
    ]);

    expect(results.filter(Boolean)).toEqual([{ ...product, stock: 7, version: 2 }]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    await expect(products.findById(product.id)).resolves.toEqual({
      ...product,
      stock: 7,
      version: 2,
    });
  });
});
