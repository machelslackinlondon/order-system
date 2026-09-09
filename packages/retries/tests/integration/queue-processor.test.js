import { describe, expect, it } from '@jest/globals';
import { createInMemoryQueue } from '@order-system/queue';

import * as retries from '../../src/index.js';

const message = {
  messageId: 'message-123',
  type: 'ORDER_CREATED',
  orderId: 'order-123',
};

async function takeOne(queue) {
  let received;
  const consuming = queue.consume(async (queuedMessage) => {
    received = queuedMessage;
    void queue.shutdown();
  });
  await consuming;
  return received;
}

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

  it('acknowledges exhausted work only after its dead letter is stored', async () => {
    const sourceQueue = createInMemoryQueue();
    const deadLetterQueue = createInMemoryQueue();
    const processor = retries.createRetryingQueueProcessor({
      sourceQueue,
      deadLetterQueue,
      retryOptions: {
        maxAttempts: 2,
        jitterRatio: 0,
        delay: async () => undefined,
        now: () => new Date('2026-09-09T16:00:00.000Z'),
      },
      async operation(_received, { attempt }) {
        if (attempt === 2) {
          void sourceQueue.shutdown();
        }
        throw new retries.TransientError('worker crashed');
      },
    });

    await sourceQueue.publish(message);
    await processor.start();

    expect(sourceQueue.getMetrics()).toMatchObject({ queueDepth: 0 });
    await expect(takeOne(deadLetterQueue)).resolves.toMatchObject({
      type: 'DEAD_LETTER',
      originalMessage: message,
      retry: {
        attempts: 2,
        classification: 'TRANSIENT',
      },
    });
  });

  it('retains the source message when dead-letter publication fails', async () => {
    const sourceQueue = createInMemoryQueue();
    const deadLetterQueue = createInMemoryQueue();
    await deadLetterQueue.shutdown();
    const processor = retries.createRetryingQueueProcessor({
      sourceQueue,
      deadLetterQueue,
      async operation() {
        throw new retries.PermanentError('invalid message');
      },
    });

    await sourceQueue.publish(message);
    await expect(processor.start()).rejects.toMatchObject({
      code: 'RETRY_INFRASTRUCTURE_ERROR',
      stage: 'DEAD_LETTER_PUBLICATION',
    });

    expect(sourceQueue.getMetrics()).toMatchObject({ queueDepth: 1 });
    await sourceQueue.shutdown();
  });
});
