import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  createOrderProcessingRepository,
  createOrderRepository,
  createPool,
  createProductRepository,
} from '@order-system/database';

import { createAtomicOrderService } from '../../src/index.js';
import { InsufficientInventoryError } from '../../src/order-errors.js';
import {
  TEST_DATABASE_URL,
  resetDatabase,
} from '../../../../packages/database/tests/integration/test-database.js';

const customerId = '33333333-3333-4333-8333-333333333333';

describe('atomic order creation', () => {
  let pool;
  let orders;
  let processing;
  let products;

  beforeAll(() => {
    pool = createPool({ connectionString: TEST_DATABASE_URL, max: 4 });
    orders = createOrderRepository(pool);
    processing = createOrderProcessingRepository(pool);
    products = createProductRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('DROP TRIGGER IF EXISTS reject_order_processing ON order_processing');
    await pool.query('DROP FUNCTION IF EXISTS reject_order_processing()');
    await resetDatabase(pool);
  });

  afterAll(async () => {
    await pool.query('DROP TRIGGER IF EXISTS reject_order_processing ON order_processing');
    await pool.query('DROP FUNCTION IF EXISTS reject_order_processing()');
    await pool.end();
  });

  async function createProduct(stock = 5) {
    return products.create({ id: randomUUID(), name: 'Mechanical Keyboard', stock, version: 1 });
  }

  function orderInput(productId, overrides = {}) {
    return {
      customerId,
      productId,
      quantity: 2,
      amount: 2598,
      idempotencyKey: `request-${randomUUID()}`,
      ...overrides,
    };
  }

  function serviceFor(orderId) {
    return createAtomicOrderService({ pool, idGenerator: () => orderId });
  }

  it('commits the order, inventory reservation, and processing record together', async () => {
    const product = await createProduct(5);
    const orderId = randomUUID();

    const order = await serviceFor(orderId).createOrder(orderInput(product.id));

    expect(order).toMatchObject({
      id: orderId,
      productId: product.id,
      quantity: 2,
      status: 'PENDING',
      version: 1,
    });
    await expect(products.findById(product.id)).resolves.toMatchObject({ stock: 3, version: 2 });
    await expect(processing.findByOrderId(orderId)).resolves.toMatchObject({
      orderId,
      status: 'PENDING',
    });
  });

  it('leaves no writes when inventory cannot be reserved', async () => {
    const product = await createProduct(1);

    await expect(
      serviceFor(randomUUID()).createOrder(orderInput(product.id)),
    ).rejects.toBeInstanceOf(InsufficientInventoryError);

    await expect(products.findById(product.id)).resolves.toMatchObject({ stock: 1, version: 1 });
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM orders'),
    ).resolves.toMatchObject({
      rows: [{ count: 0 }],
    });
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM order_processing'),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('rolls back the inventory reservation when order creation fails', async () => {
    const product = await createProduct(5);
    const duplicateOrderId = randomUUID();
    await orders.create({
      id: duplicateOrderId,
      customerId,
      productId: product.id,
      quantity: 1,
      amount: 1299,
      status: 'PENDING',
      version: 1,
      idempotencyKey: 'existing-order',
    });

    await expect(
      serviceFor(duplicateOrderId).createOrder(orderInput(product.id)),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(products.findById(product.id)).resolves.toMatchObject({ stock: 5, version: 1 });
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM orders'),
    ).resolves.toMatchObject({
      rows: [{ count: 1 }],
    });
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM order_processing'),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('rolls back the order and inventory when processing-record creation fails', async () => {
    const product = await createProduct(5);
    await pool.query(`
      CREATE FUNCTION reject_order_processing() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'processing record unavailable';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER reject_order_processing
      BEFORE INSERT ON order_processing
      FOR EACH ROW EXECUTE FUNCTION reject_order_processing();
    `);

    await expect(
      serviceFor(randomUUID()).createOrder(orderInput(product.id)),
    ).rejects.toMatchObject({ code: 'P0001' });

    await expect(products.findById(product.id)).resolves.toMatchObject({ stock: 5, version: 1 });
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM orders'),
    ).resolves.toMatchObject({
      rows: [{ count: 0 }],
    });
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM order_processing'),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });
});
