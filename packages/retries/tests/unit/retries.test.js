import { describe, expect, it } from '@jest/globals';
import { createInMemoryQueue } from '@order-system/queue';

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

  it.each([
    ['a full queue', 'QUEUE_CAPACITY_EXCEEDED'],
    ['a shut-down queue', 'QUEUE_SHUTDOWN'],
  ])('preserves the processing failure when the DLQ is %s', async (queueState, queueCode) => {
    const { executeWithRetry, PermanentError } = await retryApi;
    const deadLetterQueue = createInMemoryQueue({ capacity: 1 });
    if (queueState === 'a full queue') {
      await deadLetterQueue.publish({ messageId: 'existing-dead-letter' });
    } else {
      await deadLetterQueue.shutdown();
    }
    const processingError = new PermanentError('order payload is invalid');

    const failure = await executeWithRetry({
      message: orderMessage(),
      deadLetterQueue,
      operation: async () => {
        throw processingError;
      },
    }).catch((error) => error);

    expect(failure).toMatchObject({
      name: 'RetryInfrastructureError',
      code: 'RETRY_INFRASTRUCTURE_ERROR',
      stage: 'DEAD_LETTER_PUBLICATION',
      attempts: 1,
      classification: 'PERMANENT',
      infrastructureError: expect.objectContaining({ code: queueCode }),
    });
    expect(failure.processingError).toBe(processingError);
    expect(failure.errors).toEqual([processingError, failure.infrastructureError]);

    if (queueState === 'a full queue') {
      await deadLetterQueue.shutdown();
    }
  });

  it('preserves the transient failure when scheduling its retry fails', async () => {
    const { executeWithRetry, TransientError } = await retryApi;
    const deadLetterQueue = createInMemoryQueue();
    const processingError = new TransientError('inventory service unavailable');
    const timerError = new Error('timer unavailable');

    const failure = await executeWithRetry({
      message: orderMessage(),
      deadLetterQueue,
      operation: async () => {
        throw processingError;
      },
      delay: async () => {
        throw timerError;
      },
    }).catch((error) => error);

    expect(failure).toMatchObject({
      name: 'RetryInfrastructureError',
      code: 'RETRY_INFRASTRUCTURE_ERROR',
      stage: 'RETRY_DELAY',
      attempts: 1,
      classification: 'TRANSIENT',
    });
    expect(failure.processingError).toBe(processingError);
    expect(failure.infrastructureError).toBe(timerError);
    expect(failure.errors).toEqual([processingError, timerError]);
    expect(deadLetterQueue.getMetrics()).toMatchObject({ queueDepth: 0 });
    await deadLetterQueue.shutdown();
  });

  it('dead-letters a snapshot of the message from before processing began', async () => {
    const { executeWithRetry, PermanentError } = await retryApi;
    const deadLetterQueue = createInMemoryQueue();
    const message = orderMessage();

    await expect(
      executeWithRetry({
        message,
        deadLetterQueue,
        operation: async (processingMessage) => {
          processingMessage.payload.orderId = 'changed-by-operation';
          throw new PermanentError('order payload is invalid');
        },
      }),
    ).rejects.toMatchObject({ code: 'MESSAGE_DEAD_LETTERED' });
    message.payload.orderId = 'changed-by-caller';

    const deadLetter = await takeOne(deadLetterQueue);
    expect(deadLetter.originalMessage).toEqual(orderMessage());
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

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'plain failure'],
  ])('dead-letters %s thrown by an operation', async (_description, thrownValue) => {
    const { executeWithRetry } = await retryApi;
    const deadLetterQueue = createInMemoryQueue();

    await expect(
      executeWithRetry({
        message: orderMessage(),
        deadLetterQueue,
        operation: async () => {
          throw thrownValue;
        },
      }),
    ).rejects.toMatchObject({
      code: 'MESSAGE_DEAD_LETTERED',
      classification: 'PERMANENT',
      attempts: 1,
    });

    const deadLetter = await takeOne(deadLetterQueue);
    expect(deadLetter.retry.lastError).toEqual({
      name: 'NonErrorThrown',
      message: String(thrownValue),
    });
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

  it.each([
    ['zero base delay', { baseDelayMs: 0 }],
    ['negative base delay', { baseDelayMs: -1 }],
    ['non-finite base delay', { baseDelayMs: Number.POSITIVE_INFINITY }],
    ['negative jitter', { jitterRatio: -0.1 }],
    ['jitter over one', { jitterRatio: 1.1 }],
    ['non-finite jitter', { jitterRatio: Number.NaN }],
  ])('rejects %s', async (_description, retryOptions) => {
    const { executeWithRetry } = await retryApi;

    await expect(
      executeWithRetry({
        message: orderMessage(),
        deadLetterQueue: createInMemoryQueue(),
        operation: async () => 'processed',
        ...retryOptions,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RETRY_OPTIONS' });
  });

  it.each([-0.1, 1.1, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects invalid random output %p while preserving the processing failure',
    async (randomValue) => {
      const { executeWithRetry, TransientError } = await retryApi;
      const deadLetterQueue = createInMemoryQueue();
      const processingError = new TransientError('inventory service unavailable');
      const delays = [];

      const failure = await executeWithRetry({
        message: orderMessage(),
        deadLetterQueue,
        operation: async () => {
          throw processingError;
        },
        random: () => randomValue,
        delay: async (milliseconds) => delays.push(milliseconds),
      }).catch((error) => error);

      expect(failure).toMatchObject({
        code: 'RETRY_INFRASTRUCTURE_ERROR',
        stage: 'RETRY_DELAY',
        infrastructureError: expect.objectContaining({ code: 'INVALID_RETRY_OPTIONS' }),
      });
      expect(failure.processingError).toBe(processingError);
      expect(delays).toEqual([]);
      await deadLetterQueue.shutdown();
    },
  );
});
