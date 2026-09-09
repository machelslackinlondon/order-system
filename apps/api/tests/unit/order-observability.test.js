import { afterEach, describe, expect, it } from '@jest/globals';
import * as observability from '@order-system/observability';

import { buildApp } from '../../src/index.js';

function localObservability(options) {
  expect(observability.createLocalObservability).toEqual(expect.any(Function));
  return observability.createLocalObservability(options);
}

const order = {
  id: '22222222-2222-4222-8222-222222222222',
  customerId: '33333333-3333-4333-8333-333333333333',
  productId: '11111111-1111-4111-8111-111111111111',
  quantity: 2,
  amount: 2500,
  status: 'PENDING',
  version: 1,
  idempotencyKey: 'checkout-123',
  createdAt: '2026-09-09T14:00:00.000Z',
  updatedAt: '2026-09-09T14:00:00.000Z',
};

const request = {
  method: 'POST',
  url: '/orders',
  headers: {
    'content-type': 'application/json',
    'idempotency-key': 'checkout-123',
    'x-correlation-id': 'correlation-123',
  },
  payload: {
    customerId: order.customerId,
    productId: order.productId,
    quantity: order.quantity,
    amount: order.amount,
  },
};

describe('order request observability', () => {
  let app;

  afterEach(async () => {
    await app?.close();
  });

  it('propagates request context and records a created order', async () => {
    const records = [];
    let receivedInput;
    let elapsed = 5;
    const telemetry = localObservability({
      write: (record) => records.push(record),
      wallClock: () => new Date('2026-09-09T14:00:01.000Z'),
      monotonicClock: () => elapsed,
    });
    app = buildApp({
      observability: telemetry,
      orderService: {
        async createOrder(input) {
          receivedInput = input;
          elapsed = 20;
          return order;
        },
      },
    });

    const response = await app.inject(request);

    expect(response.statusCode).toBe(201);
    expect(response.headers['x-correlation-id']).toBe('correlation-123');
    expect(receivedInput.requestContext).toEqual({
      requestId: expect.any(String),
      correlationId: 'correlation-123',
      orderId: null,
      messageId: null,
      workerId: null,
    });
    expect(records).toEqual([
      {
        level: 'info',
        event: 'order.create',
        requestId: receivedInput.requestContext.requestId,
        correlationId: 'correlation-123',
        orderId: order.id,
        messageId: null,
        workerId: null,
        timestamp: '2026-09-09T14:00:01.000Z',
        duration: 15,
        status: 'CREATED',
      },
    ]);
    expect(telemetry.metrics.snapshot()).toMatchObject({ orders_created_total: 0 });
  });

  it('uses the request ID as correlation ID and records service errors', async () => {
    const records = [];
    let receivedInput;
    const serviceError = Object.assign(new Error('database unavailable'), {
      code: 'DATABASE_UNAVAILABLE',
    });
    const telemetry = localObservability({
      write: (record) => records.push(record),
      wallClock: () => new Date('2026-09-09T14:02:00.000Z'),
      monotonicClock: () => 10,
    });
    app = buildApp({
      observability: telemetry,
      orderService: {
        async createOrder(input) {
          receivedInput = input;
          throw serviceError;
        },
      },
    });

    const response = await app.inject({
      ...request,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'checkout-123',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(receivedInput.requestContext.correlationId).toBe(receivedInput.requestContext.requestId);
    expect(response.headers['x-correlation-id']).toBe(receivedInput.requestContext.requestId);
    expect(records).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'order.create',
        requestId: receivedInput.requestContext.requestId,
        correlationId: receivedInput.requestContext.requestId,
        status: 'FAILED',
        error: {
          name: 'Error',
          message: 'database unavailable',
          code: 'DATABASE_UNAVAILABLE',
        },
      }),
    ]);
    expect(telemetry.metrics.snapshot()).toMatchObject({ orders_failed_total: 1 });
  });

  it('records a failed outcome when response serialization rejects the order', async () => {
    const records = [];
    const telemetry = localObservability({ write: (record) => records.push(record) });
    app = buildApp({
      observability: telemetry,
      orderService: {
        async createOrder() {
          const invalidOrder = { ...order };
          delete invalidOrder.id;
          return invalidOrder;
        },
      },
    });

    const response = await app.inject(request);

    expect(response.statusCode).toBe(500);
    expect(response.headers['x-correlation-id']).toBe('correlation-123');
    expect(records).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'order.create',
        correlationId: 'correlation-123',
        status: 'FAILED',
        error: expect.objectContaining({ name: 'Error' }),
      }),
    ]);
    expect(telemetry.metrics.snapshot()).toMatchObject({ orders_failed_total: 1 });
  });

  it.each([
    ['invalid body', { ...request, payload: { ...request.payload, quantity: 0 } }],
    [
      'missing idempotency key',
      {
        ...request,
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'correlation-123',
        },
      },
    ],
  ])('returns the correlation ID for %s validation errors', async (_case, invalidRequest) => {
    const records = [];
    const telemetry = localObservability({ write: (record) => records.push(record) });
    app = buildApp({
      observability: telemetry,
      orderService: { createOrder: () => order },
    });

    const response = await app.inject(invalidRequest);

    expect(response.statusCode).toBe(400);
    expect(response.headers['x-correlation-id']).toBe('correlation-123');
    expect(records).toEqual([]);
  });
});
