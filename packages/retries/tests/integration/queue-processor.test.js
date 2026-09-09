import { describe, expect, it } from '@jest/globals';
import { createInMemoryQueue } from '@order-system/queue';

import * as retries from '../../src/index.js';

const message = {
  messageId: 'message-123',
  type: 'ORDER_CREATED',
  orderId: 'order-123',
};

describe('local retrying queue processor', () => {
  it('retries a transient queue delivery before acknowledging it', async () => {
    expect(retries.createRetryingQueueProcessor).toEqual(expect.any(Function));
    const sourceQueue = createInMemoryQueue();
    const deadLetterQueue = createInMemoryQueue();
    const attempts = [];
    const delays = [];
    const processor = retries.createRetryingQueueProcessor({
      sourceQueue,
      deadLetterQueue,
      retryOptions: {
        maxAttempts: 3,
        jitterRatio: 0,
        delay: async (milliseconds) => delays.push(milliseconds),
      },
      async operation(received, { attempt }) {
        attempts.push({ received, attempt });
        if (attempt < 3) {
          throw new retries.TransientError('temporary worker failure');
        }
        void sourceQueue.shutdown();
        return 'processed';
      },
    });

    await sourceQueue.publish(message);
    await processor.start();

    expect(attempts).toEqual([
      { received: message, attempt: 1 },
      { received: message, attempt: 2 },
      { received: message, attempt: 3 },
    ]);
    expect(delays).toEqual([1000, 2000]);
    expect(sourceQueue.getMetrics()).toMatchObject({ queueDepth: 0 });
    expect(deadLetterQueue.getMetrics()).toMatchObject({ queueDepth: 0 });
    await deadLetterQueue.shutdown();
  });
});
