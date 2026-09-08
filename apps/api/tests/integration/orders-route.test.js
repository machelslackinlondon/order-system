import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createOrderRepository,
  createPool,
  createProductRepository,
  DatabaseUnavailableError,
} from '@distributed-order-system/database';

import { buildApp } from '../../src/app.js';
import { createOrderService } from '../../src/create-order.js';
import {
  TEST_DATABASE_URL,
  resetDatabase,
} from '../../../../packages/database/tests/integration/test-database.js';

const customerId = '33333333-3333-4333-8333-333333333333';

describe('POST /orders', () => {
  let app;
  let pool;
  let products;

  beforeAll(async () => {
    pool = createPool({ connectionString: TEST_DATABASE_URL, max: 4 });
    products = createProductRepository(pool);
    const orderService = createOrderService({
      productRepository: products,
      orderRepository: createOrderRepository(pool),
      idGenerator: randomUUID,
    });
    app = buildApp({ orderService });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function createProduct(stock = 5) {
    return products.create({
      id: randomUUID(),
      name: 'Interview Keyboard',
      stock,
      version: 1,
    });
  }

  function requestFor(productId, overrides = {}) {
    return {
      method: 'POST',
      url: '/orders',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'request-123',
      },
      payload: {
        customerId,
        productId,
        quantity: 2,
        amount: 2598,
      },
      ...overrides,
    };
  }

  it('persists and returns a PENDING order without decrementing stock', async () => {
    const product = await createProduct();

    const response = await app.inject(requestFor(product.id));
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body).toEqual({
      id: expect.any(String),
      customerId,
      productId: product.id,
      quantity: 2,
      amount: 2598,
      status: 'PENDING',
      version: 1,
      idempotencyKey: 'request-123',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
    expect(new Date(body.updatedAt).toISOString()).toBe(body.updatedAt);
    await expect(products.findById(product.id)).resolves.toMatchObject({ stock: 5 });
    await expect(
      pool.query('SELECT count(*)::integer AS count FROM orders'),
    ).resolves.toMatchObject({
      rows: [{ count: 1 }],
    });
  });

  it('returns 400 for an invalid body', async () => {
    const product = await createProduct();
    const response = await app.inject(
      requestFor(product.id, {
        payload: {
          customerId,
          productId: product.id,
          quantity: 0,
          amount: 2598,
        },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  });

  it('returns 400 when the body contains an unexpected property', async () => {
    const product = await createProduct();
    const response = await app.inject(
      requestFor(product.id, {
        payload: {
          customerId,
          productId: product.id,
          quantity: 2,
          amount: 2598,
          unexpected: true,
        },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  });

  it('returns 400 when quantity is represented as a string', async () => {
    const product = await createProduct();
    const response = await app.inject(
      requestFor(product.id, {
        payload: {
          customerId,
          productId: product.id,
          quantity: '2',
          amount: 2598,
        },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  });

  it('returns 400 when Idempotency-Key is missing', async () => {
    const product = await createProduct();
    const response = await app.inject(
      requestFor(product.id, {
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  });

  it('returns a stable 400 envelope when Idempotency-Key is whitespace only', async () => {
    const product = await createProduct();
    const response = await app.inject(
      requestFor(product.id, {
        headers: {
          'content-type': 'application/json',
          'idempotency-key': '   ',
        },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  });

  it('returns 400 for malformed JSON', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'request-123',
      },
      payload: '{',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  });

  it('returns 400 for an empty JSON body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'request-123',
      },
      payload: '',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  });

  it('returns 400 when Content-Type is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { 'idempotency-key': 'request-123' },
      payload: JSON.stringify({
        customerId,
        productId: randomUUID(),
        quantity: 2,
        amount: 2598,
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  });

  it('returns 400 for an unsupported Content-Type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: {
        'content-type': 'application/xml',
        'idempotency-key': 'request-123',
      },
      payload: '<order />',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
  });

  it('returns 404 for an unknown product', async () => {
    const response = await app.inject(requestFor(randomUUID()));

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' },
    });
  });

  it('returns 409 when current stock is insufficient', async () => {
    const product = await createProduct(1);
    const response = await app.inject(requestFor(product.id));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'INSUFFICIENT_INVENTORY',
        message: 'Insufficient inventory',
      },
    });
  });

  it('returns 503 without leaking database details', async () => {
    const unavailableApp = buildApp({
      orderService: {
        createOrder: jest.fn().mockRejectedValue(
          new DatabaseUnavailableError({
            cause: new Error('password=secret connection refused'),
          }),
        ),
      },
    });

    const response = await unavailableApp.inject(requestFor(randomUUID()));
    await unavailableApp.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Database unavailable' },
    });
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('connection refused');
  });

  it('returns 500 without leaking unexpected error details', async () => {
    const brokenApp = buildApp({
      orderService: {
        createOrder: jest.fn().mockRejectedValue(new Error('SQL text leaked')),
      },
    });

    const response = await brokenApp.inject(requestFor(randomUUID()));
    await brokenApp.close();

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(response.body).not.toContain('SQL text leaked');
  });
});
