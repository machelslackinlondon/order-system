import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { createOrderRepository, createProductRepository } from '../../src/index.js';
import { createTestPool, resetDatabase } from './test-database.js';

describe('PostgreSQL order persistence', () => {
  let pool;
  let products;
  let orders;

  beforeAll(() => {
    pool = createTestPool();
    products = createProductRepository(pool);
    orders = createOrderRepository(pool);
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates and finds persisted inventory', async () => {
    const product = {
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock: 5,
      version: 1,
    };

    await expect(products.create(product)).resolves.toEqual(product);
    await expect(products.findById(product.id)).resolves.toEqual(product);
  });

  it('persists every order field with database timestamps', async () => {
    const product = await products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock: 5,
      version: 1,
    });
    const input = {
      id: randomUUID(),
      customerId: randomUUID(),
      productId: product.id,
      quantity: 2,
      amount: 2598,
      status: 'PENDING',
      version: 1,
      idempotencyKey: 'request-1',
    };

    const order = await orders.create(input);

    expect(order).toEqual({
      ...input,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it('enforces non-negative product stock', async () => {
    await expect(
      pool.query('INSERT INTO products (id, name, stock, version) VALUES ($1, $2, $3, $4)', [
        randomUUID(),
        'Broken Inventory',
        -1,
        1,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces positive order quantity', async () => {
    const product = await products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock: 5,
      version: 1,
    });

    await expect(
      orders.create({
        id: randomUUID(),
        customerId: randomUUID(),
        productId: product.id,
        quantity: 0,
        amount: 1,
        status: 'PENDING',
        version: 1,
        idempotencyKey: 'invalid-order',
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces positive order amount', async () => {
    const product = await products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock: 5,
      version: 1,
    });

    await expect(
      orders.create({
        id: randomUUID(),
        customerId: randomUUID(),
        productId: product.id,
        quantity: 1,
        amount: 0,
        status: 'PENDING',
        version: 1,
        idempotencyKey: 'invalid-amount',
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces positive product and order versions', async () => {
    await expect(
      pool.query('INSERT INTO products (id, name, stock, version) VALUES ($1, $2, $3, $4)', [
        randomUUID(),
        'Invalid Version',
        1,
        0,
      ]),
    ).rejects.toMatchObject({ code: '23514' });

    const product = await products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock: 5,
      version: 1,
    });

    await expect(
      orders.create({
        id: randomUUID(),
        customerId: randomUUID(),
        productId: product.id,
        quantity: 1,
        amount: 1299,
        status: 'PENDING',
        version: 0,
        idempotencyKey: 'invalid-version',
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces allowed order statuses', async () => {
    const product = await products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock: 5,
      version: 1,
    });

    await expect(
      orders.create({
        id: randomUUID(),
        customerId: randomUUID(),
        productId: product.id,
        quantity: 1,
        amount: 1299,
        status: 'UNKNOWN',
        version: 1,
        idempotencyKey: 'invalid-status',
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces the product foreign key', async () => {
    await expect(
      orders.create({
        id: randomUUID(),
        customerId: randomUUID(),
        productId: randomUUID(),
        quantity: 1,
        amount: 1299,
        status: 'PENDING',
        version: 1,
        idempotencyKey: 'missing-product',
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('enforces unique order idempotency keys', async () => {
    const product = await products.create({
      id: randomUUID(),
      name: 'Mechanical Keyboard',
      stock: 5,
      version: 1,
    });
    const common = {
      customerId: randomUUID(),
      productId: product.id,
      quantity: 1,
      amount: 1299,
      status: 'PENDING',
      version: 1,
      idempotencyKey: 'unique-request',
    };

    await expect(orders.create({ ...common, id: randomUUID() })).resolves.toBeDefined();
    await expect(orders.create({ ...common, id: randomUUID() })).rejects.toMatchObject({
      code: '23505',
    });
  });
});
