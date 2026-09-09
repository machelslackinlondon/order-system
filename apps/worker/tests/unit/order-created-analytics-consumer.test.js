import { describe, expect, it } from '@jest/globals';

import * as worker from '../../src/index.js';

function orderCreated(overrides = {}) {
  return {
    messageId: 'order-created:order-123',
    type: 'ORDER_CREATED',
    orderId: 'order-123',
    timestamp: '2026-09-09T12:00:00.000Z',
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function analyticsConsumer(writeRecord) {
  expect(worker.createOrderCreatedAnalyticsConsumer).toEqual(expect.any(Function));
  return worker.createOrderCreatedAnalyticsConsumer({ writeRecord });
}

describe('order-created analytics consumer', () => {
  it('writes a compact analytics record for a valid event', async () => {
    const records = [];
    const consumer = analyticsConsumer(async (record) => {
      records.push(record);
    });

    await expect(consumer.handle(orderCreated())).resolves.toEqual({ status: 'RECORDED' });
    expect(records).toEqual([
      {
        messageId: 'order-created:order-123',
        orderId: 'order-123',
        occurredAt: '2026-09-09T12:00:00.000Z',
      },
    ]);
  });

  it('writes once when the same event is delivered repeatedly', async () => {
    const releaseWrite = deferred();
    const records = [];
    const consumer = analyticsConsumer(async (record) => {
      records.push(record);
      await releaseWrite.promise;
    });
    const first = consumer.handle(orderCreated());

    await expect(consumer.handle(orderCreated())).resolves.toEqual({ status: 'DUPLICATE' });
    releaseWrite.resolve();
    await expect(first).resolves.toEqual({ status: 'RECORDED' });
    await expect(consumer.handle(orderCreated())).resolves.toEqual({ status: 'DUPLICATE' });
    expect(records).toHaveLength(1);
  });

  it('rejects an invalid event without writing a record', async () => {
    const records = [];
    const consumer = analyticsConsumer(async (record) => {
      records.push(record);
    });

    await expect(consumer.handle(orderCreated({ type: 'ORDER_CANCELLED' }))).rejects.toMatchObject({
      code: 'INVALID_ORDER_CREATED_EVENT',
    });
    expect(records).toEqual([]);
  });

  it('propagates a downstream failure', async () => {
    const downstreamError = new Error('analytics unavailable');
    const consumer = analyticsConsumer(async () => {
      throw downstreamError;
    });

    await expect(consumer.handle(orderCreated())).rejects.toBe(downstreamError);
  });

  it('allows a safe retry after a downstream failure', async () => {
    const downstreamError = new Error('analytics unavailable');
    const records = [];
    let attempts = 0;
    const consumer = analyticsConsumer(async (record) => {
      attempts += 1;
      if (attempts === 1) {
        throw downstreamError;
      }
      records.push(record);
    });

    await expect(consumer.handle(orderCreated())).rejects.toBe(downstreamError);
    await expect(consumer.handle(orderCreated())).resolves.toEqual({ status: 'RECORDED' });
    expect(records).toHaveLength(1);
  });
});
