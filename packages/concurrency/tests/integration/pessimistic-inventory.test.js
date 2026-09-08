import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import * as database from '@order-system/database';
import * as concurrency from '../../src/index.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://orders:orders_dev@127.0.0.1:5432/orders_test';

describe('pessimistic inventory reservation', () => {
  let pool;
  let products;

  beforeAll(() => {
    pool = database.createPool({ connectionString: TEST_DATABASE_URL, max: 6 });
    products = database.createProductRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE orders, products CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createProduct(stock = 10) {
    return products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock,
      version: 1,
    });
  }

  it('serializes concurrent reservations for the same inventory', async () => {
    const product = await createProduct();

    expect(concurrency.createPessimisticInventoryReservation).toEqual(expect.any(Function));

    const reserve = concurrency.createPessimisticInventoryReservation({ pool });
    const results = await Promise.all([
      reserve({ productId: product.id, quantity: 3 }),
      reserve({ productId: product.id, quantity: 3 }),
    ]);

    expect(results.sort((left, right) => left.version - right.version)).toEqual([
      { ...product, stock: 7, version: 2 },
      { ...product, stock: 4, version: 3 },
    ]);
    await expect(products.findById(product.id)).resolves.toEqual({
      ...product,
      stock: 4,
      version: 3,
    });
  });

  it('rolls back when stock is insufficient', async () => {
    const product = await createProduct(2);
    const reserve = concurrency.createPessimisticInventoryReservation({ pool });

    await expect(reserve({ productId: product.id, quantity: 3 })).rejects.toMatchObject({
      name: 'InsufficientInventoryError',
      code: 'INSUFFICIENT_INVENTORY',
      productId: product.id,
    });
    await expect(products.findById(product.id)).resolves.toEqual(product);
  });

  it.each([0, -1, 1.5])('rejects invalid reservation quantity %s', async (quantity) => {
    const product = await createProduct();
    const reserve = concurrency.createPessimisticInventoryReservation({ pool });

    await expect(reserve({ productId: product.id, quantity })).rejects.toMatchObject({
      name: 'InvalidInventoryQuantityError',
      code: 'INVALID_INVENTORY_QUANTITY',
      quantity,
    });
    await expect(products.findById(product.id)).resolves.toEqual(product);
  });

  it('reports a typed error when inventory does not exist', async () => {
    const productId = randomUUID();
    const reserve = concurrency.createPessimisticInventoryReservation({ pool });

    await expect(reserve({ productId, quantity: 1 })).rejects.toMatchObject({
      name: 'InventoryProductNotFoundError',
      code: 'INVENTORY_PRODUCT_NOT_FOUND',
      productId,
    });
  });

  it('rolls back inventory writes when transactional work fails', async () => {
    const product = await createProduct();
    const failure = new Error('processing failed');

    expect(database.withTransaction).toEqual(expect.any(Function));

    await expect(
      database.withTransaction(pool, async (client) => {
        const lockedProducts = database.createProductRepository(client);

        await lockedProducts.findByIdForUpdate(product.id);
        await lockedProducts.reserveLocked({ productId: product.id, quantity: 3 });
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expect(products.findById(product.id)).resolves.toEqual(product);
  });

  it.each(['COMMIT', 'ROLLBACK'])('acquires and releases a row lock after %s', async (release) => {
    const product = await createProduct();
    const holder = await pool.connect();
    const contender = await pool.connect();
    let holderTransactionOpen = false;
    let contenderTransactionOpen = false;

    try {
      await holder.query('BEGIN');
      holderTransactionOpen = true;

      const lockedProducts = database.createProductRepository(holder);
      expect(lockedProducts.findByIdForUpdate).toEqual(expect.any(Function));
      await lockedProducts.findByIdForUpdate(product.id);

      await contender.query('BEGIN');
      contenderTransactionOpen = true;
      await expect(
        contender.query('SELECT id FROM products WHERE id = $1 FOR UPDATE NOWAIT', [product.id]),
      ).rejects.toMatchObject({ code: '55P03' });
      await contender.query('ROLLBACK');
      contenderTransactionOpen = false;

      await holder.query(release);
      holderTransactionOpen = false;

      await contender.query('BEGIN');
      contenderTransactionOpen = true;
      await expect(
        contender.query('SELECT id FROM products WHERE id = $1 FOR UPDATE NOWAIT', [product.id]),
      ).resolves.toMatchObject({ rowCount: 1 });
      await contender.query('ROLLBACK');
      contenderTransactionOpen = false;
    } finally {
      if (holderTransactionOpen) {
        await holder.query('ROLLBACK');
      }
      if (contenderTransactionOpen) {
        await contender.query('ROLLBACK');
      }
      holder.release();
      contender.release();
    }
  });
});
