import { describe, expect, it } from '@jest/globals';
import { createInMemoryQueue } from '@order-system/queue';
import { createOrderCreatedPublisher } from '../../src/index.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('order-created publisher', () => {
  it('publishes a stable ORDER_CREATED message for an order', async () => {
    const queue = createInMemoryQueue();
    const publisher = createOrderCreatedPublisher({ queue });
    const delivered = deferred();
    const consuming = queue.consume(async (message) => {
      delivered.resolve(message);
    });

    await publisher.publish({
      id: '22222222-2222-4222-8222-222222222222',
      createdAt: new Date('2026-09-08T12:00:00.000Z'),
    });

    await expect(delivered.promise).resolves.toEqual({
      messageId: 'order-created:22222222-2222-4222-8222-222222222222',
      type: 'ORDER_CREATED',
      orderId: '22222222-2222-4222-8222-222222222222',
      timestamp: '2026-09-08T12:00:00.000Z',
    });
    await queue.shutdown();
    await consuming;
  });
});
