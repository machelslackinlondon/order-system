import { describe, expect, it } from '@jest/globals';
import { createInMemoryQueue } from '../../../queue/src/index.js';

const retryApi = import('../../src/index.js');

function orderMessage() {
  return {
    messageId: 'message-123',
    type: 'ORDER_CREATED',
    payload: { orderId: 'order-123' },
  };
}

async function takeOne(queue) {
  let received;
  let resolveReceived;
  const messageReceived = new Promise((resolve) => {
    resolveReceived = resolve;
  });
  const consuming = queue.consume(async (message) => {
    received = message;
    resolveReceived();
  });

  await messageReceived;
  await queue.shutdown();
  await consuming;
  return received;
}

describe('retry processing', () => {
  it('returns a successful first attempt without scheduling a retry', async () => {
    const { executeWithRetry } = await retryApi;
    const deadLetterQueue = createInMemoryQueue();
    const attempts = [];
    const delays = [];

    const result = await executeWithRetry({
      message: orderMessage(),
      deadLetterQueue,
      operation: async (_message, context) => {
        attempts.push(context);
        return 'processed';
      },
      delay: async (milliseconds) => delays.push(milliseconds),
    });

    expect(result).toBe('processed');
    expect(attempts).toEqual([{ attempt: 1, maxAttempts: 5 }]);
    expect(delays).toEqual([]);
    expect(deadLetterQueue.getMetrics()).toMatchObject({ queueDepth: 0 });
    await deadLetterQueue.shutdown();
  });

  it('retries transient failures until the operation succeeds', async () => {
    const { executeWithRetry, TransientError } = await retryApi;
    const deadLetterQueue = createInMemoryQueue();
    const attempts = [];
    const delays = [];

    const result = await executeWithRetry({
      message: orderMessage(),
      deadLetterQueue,
      maxAttempts: 4,
      jitterRatio: 0,
      operation: async (_message, { attempt }) => {
        attempts.push(attempt);
        if (attempt < 3) {
          throw new TransientError('inventory service unavailable');
        }
        return 'processed';
      },
      delay: async (milliseconds) => delays.push(milliseconds),
    });

    expect(result).toBe('processed');
    expect(attempts).toEqual([1, 2, 3]);
    expect(delays).toEqual([1000, 2000]);
    expect(deadLetterQueue.getMetrics()).toMatchObject({ queueDepth: 0 });
    await deadLetterQueue.shutdown();
  });

  it('dead-letters a permanent failure without retrying it', async () => {
    const { executeWithRetry, MessageDeadLetteredError, PermanentError } = await retryApi;
    const deadLetterQueue = createInMemoryQueue();
    const attempts = [];
    const delays = [];

    await expect(
      executeWithRetry({
        message: orderMessage(),
        deadLetterQueue,
        operation: async (_message, { attempt }) => {
          attempts.push(attempt);
          throw new PermanentError('order payload is invalid');
        },
        delay: async (milliseconds) => delays.push(milliseconds),
        now: () => new Date('2026-09-08T10:00:00.000Z'),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: MessageDeadLetteredError.name,
        code: 'MESSAGE_DEAD_LETTERED',
        attempts: 1,
        classification: 'PERMANENT',
      }),
    );

    expect(attempts).toEqual([1]);
    expect(delays).toEqual([]);
    await expect(takeOne(deadLetterQueue)).resolves.toEqual({
      type: 'DEAD_LETTER',
      originalMessage: orderMessage(),
      retry: {
        attempts: 1,
        maxAttempts: 5,
        classification: 'PERMANENT',
        firstAttemptAt: '2026-09-08T10:00:00.000Z',
        failedAt: '2026-09-08T10:00:00.000Z',
        lastError: {
          name: 'PermanentError',
          message: 'order payload is invalid',
          code: 'PERMANENT_ERROR',
        },
      },
    });
  });

  it('treats an unclassified error as permanent', async () => {
    const { executeWithRetry } = await retryApi;
    const deadLetterQueue = createInMemoryQueue();
    let attempts = 0;

    await expect(
      executeWithRetry({
        message: orderMessage(),
        deadLetterQueue,
        operation: async () => {
          attempts += 1;
          throw new Error('unexpected application failure');
        },
      }),
    ).rejects.toMatchObject({ classification: 'PERMANENT', attempts: 1 });

    expect(attempts).toBe(1);
    const deadLetter = await takeOne(deadLetterQueue);
    expect(deadLetter.retry.classification).toBe('PERMANENT');
  });

  it('uses bounded exponential backoff before dead-lettering exhausted work', async () => {
    const { executeWithRetry, TransientError } = await retryApi;
    const deadLetterQueue = createInMemoryQueue();
    const attempts = [];
    const delays = [];

    await expect(
      executeWithRetry({
        message: orderMessage(),
        deadLetterQueue,
        maxAttempts: 5,
        jitterRatio: 0,
        operation: async (_message, { attempt }) => {
          attempts.push(attempt);
          throw new TransientError('payment service unavailable');
        },
        delay: async (milliseconds) => delays.push(milliseconds),
        now: () => new Date('2026-09-08T11:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'MESSAGE_DEAD_LETTERED',
      classification: 'TRANSIENT',
      attempts: 5,
    });

    expect(attempts).toEqual([1, 2, 3, 4, 5]);
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
    const deadLetter = await takeOne(deadLetterQueue);
    expect(deadLetter.retry).toEqual({
      attempts: 5,
      maxAttempts: 5,
      classification: 'TRANSIENT',
      firstAttemptAt: '2026-09-08T11:00:00.000Z',
      failedAt: '2026-09-08T11:00:00.000Z',
      lastError: {
        name: 'TransientError',
        message: 'payment service unavailable',
        code: 'TRANSIENT_ERROR',
      },
    });
  });

  it('keeps jitter within the configured percentage of the backoff delay', async () => {
    const { executeWithRetry, TransientError } = await retryApi;
    const observedDelays = [];

    for (const random of [() => 0, () => 1]) {
      const deadLetterQueue = createInMemoryQueue();
      let attempts = 0;
      await executeWithRetry({
        message: orderMessage(),
        deadLetterQueue,
        maxAttempts: 2,
        jitterRatio: 0.2,
        random,
        operation: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new TransientError('try again');
          }
          return 'processed';
        },
        delay: async (milliseconds) => observedDelays.push(milliseconds),
      });
      await deadLetterQueue.shutdown();
    }

    expect(observedDelays).toEqual([800, 1200]);
  });

  it.each([0, -1, 1.5])('rejects invalid maximum attempts %p', async (maxAttempts) => {
    const { executeWithRetry } = await retryApi;

    await expect(
      executeWithRetry({
        message: orderMessage(),
        deadLetterQueue: createInMemoryQueue(),
        maxAttempts,
        operation: async () => 'processed',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RETRY_OPTIONS' });
  });
});
