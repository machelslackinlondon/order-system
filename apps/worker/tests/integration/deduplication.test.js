import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { createTestPool, resetDatabase } from '../../../../packages/database/tests/integration/test-database.js';

const databaseApi = import('@order-system/database');
const workerApi = import('../../src/index.js');

function message() {
  return {
    messageId: 'order-created:order-123',
    type: 'ORDER_CREATED',
    payload: { orderId: 'order-123' },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createOrder(pool) {
  const productId = randomUUID();
  const orderId = randomUUID();
  await pool.query('INSERT INTO products (id, name, stock, version) VALUES ($1, $2, $3, $4)', [
    productId,
    'Mechanical Keyboard',
    5,
    1,
  ]);
  await pool.query(
    `
      INSERT INTO orders (
        id, customer_id, product_id, quantity, amount, status, version, idempotency_key
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [orderId, randomUUID(), productId, 1, 1299, 'PENDING', 1, `request-${orderId}`],
  );
  return orderId;
}

describe('idempotent message processing', () => {
  let pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('processes and records a message the first time it is received', async () => {
    const { createProcessedMessageRepository } = await databaseApi;
    const { createIdempotentMessageProcessor } = await workerApi;
    const handled = [];
    const processor = createIdempotentMessageProcessor({
      pool,
      handler: async (receivedMessage) => {
        handled.push(receivedMessage);
        return 'handled';
      },
    });

    await expect(processor.process(message())).resolves.toEqual({
      status: 'PROCESSED',
      result: 'handled',
    });
    expect(handled).toEqual([message()]);
    await expect(
      createProcessedMessageRepository(pool).findByMessageId(message().messageId),
    ).resolves.toMatchObject({
      messageId: message().messageId,
      processedAt: expect.any(Date),
    });
  });

  it('ignores a duplicate without invoking the handler again', async () => {
    const { createIdempotentMessageProcessor } = await workerApi;
    let handlerCalls = 0;
    const processor = createIdempotentMessageProcessor({
      pool,
      handler: async () => {
        handlerCalls += 1;
        return 'handled';
      },
    });

    await processor.process(message());

    await expect(processor.process(message())).resolves.toEqual({ status: 'DUPLICATE' });
    expect(handlerCalls).toBe(1);
  });

  it('allows only one concurrent delivery to invoke the handler', async () => {
    const { createIdempotentMessageProcessor } = await workerApi;
    const firstStarted = deferred();
    const releaseFirst = deferred();
    let handlerCalls = 0;
    const processor = createIdempotentMessageProcessor({
      pool,
      handler: async () => {
        handlerCalls += 1;
        firstStarted.resolve();
        await releaseFirst.promise;
        return 'handled';
      },
    });

    const firstDelivery = processor.process(message());
    await firstStarted.promise;
    const concurrentDelivery = processor.process(message());
    releaseFirst.resolve();

    await expect(Promise.all([firstDelivery, concurrentDelivery])).resolves.toEqual([
      { status: 'PROCESSED', result: 'handled' },
      { status: 'DUPLICATE' },
    ]);
    expect(handlerCalls).toBe(1);
  });

  it('does not record a message when its handler fails', async () => {
    const { createProcessedMessageRepository } = await databaseApi;
    const { createIdempotentMessageProcessor } = await workerApi;
    const processingError = new Error('processing failed');
    const processor = createIdempotentMessageProcessor({
      pool,
      handler: async () => {
        throw processingError;
      },
    });

    await expect(processor.process(message())).rejects.toBe(processingError);
    await expect(
      createProcessedMessageRepository(pool).findByMessageId(message().messageId),
    ).resolves.toBeNull();
  });

  it('rolls back handler database writes when processing fails', async () => {
    const { createProcessedMessageRepository } = await databaseApi;
    const { createIdempotentMessageProcessor } = await workerApi;
    const orderId = await createOrder(pool);
    const processor = createIdempotentMessageProcessor({
      pool,
      handler: async (_receivedMessage, { client }) => {
        await client.query(
          'INSERT INTO order_processing (order_id, status) VALUES ($1, $2)',
          [orderId, 'PROCESSING'],
        );
        throw new Error('processing failed after database write');
      },
    });

    await expect(processor.process(message())).rejects.toThrow(
      'processing failed after database write',
    );

    await expect(
      createProcessedMessageRepository(pool).findByMessageId(message().messageId),
    ).resolves.toBeNull();
    await expect(
      pool.query('SELECT order_id FROM order_processing WHERE order_id = $1', [orderId]),
    ).resolves.toMatchObject({ rowCount: 0 });
  });
});
