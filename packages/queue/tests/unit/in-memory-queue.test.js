import { describe, expect, it } from '@jest/globals';
import { createInMemoryQueue } from '../../src/index.js';

const firstMessage = { messageId: 'message-1', type: 'ORDER_CREATED' };
const secondMessage = { messageId: 'message-2', type: 'ORDER_CREATED' };

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('in-memory queue', () => {
  it('delivers a message published after consumption starts', async () => {
    const queue = createInMemoryQueue();
    const delivered = deferred();
    const consuming = queue.consume(async (message) => {
      delivered.resolve(message);
    });

    await queue.publish(firstMessage);

    await expect(delivered.promise).resolves.toBe(firstMessage);
    await queue.shutdown();
    await consuming;
  });

  it('delivers queued messages in first-in-first-out order', async () => {
    const queue = createInMemoryQueue();
    const delivered = [];
    const bothDelivered = deferred();
    await queue.publish(firstMessage);
    await queue.publish(secondMessage);

    const consuming = queue.consume(async (message) => {
      delivered.push(message.messageId);
      if (delivered.length === 2) {
        bothDelivered.resolve();
      }
    });
    await bothDelivered.promise;

    expect(delivered).toEqual(['message-1', 'message-2']);
    await queue.shutdown();
    await consuming;
  });

  it('rejects consumption when the handler fails', async () => {
    const queue = createInMemoryQueue();
    const handlerError = new Error('processing failed');
    await queue.publish(firstMessage);

    await expect(
      queue.consume(async () => {
        throw handlerError;
      }),
    ).rejects.toBe(handlerError);

    await queue.shutdown();
  });

  it('redelivers a message that was not acknowledged', async () => {
    const queue = createInMemoryQueue();
    const attempts = [];
    const handlerError = new Error('processing failed');
    await queue.publish(firstMessage);
    await expect(
      queue.consume(async (message) => {
        attempts.push(message.messageId);
        throw handlerError;
      }),
    ).rejects.toBe(handlerError);

    const redelivered = deferred();
    const consuming = queue.consume(async (message) => {
      attempts.push(message.messageId);
      redelivered.resolve();
    });
    await redelivered.promise;

    expect(attempts).toEqual(['message-1', 'message-1']);
    await queue.shutdown();
    await consuming;
  });

  it('does not redeliver a message acknowledged before a later failure', async () => {
    const queue = createInMemoryQueue();
    const firstAttempts = [];
    const handlerError = new Error('second message failed');
    await queue.publish(firstMessage);
    await queue.publish(secondMessage);
    await expect(
      queue.consume(async (message) => {
        firstAttempts.push(message.messageId);
        if (message === secondMessage) {
          throw handlerError;
        }
      }),
    ).rejects.toBe(handlerError);

    const secondAttempts = [];
    const redelivered = deferred();
    const consuming = queue.consume(async (message) => {
      secondAttempts.push(message.messageId);
      redelivered.resolve();
    });
    await redelivered.promise;

    expect(firstAttempts).toEqual(['message-1', 'message-2']);
    expect(secondAttempts).toEqual(['message-2']);
    await queue.shutdown();
    await consuming;
  });

  it('waits for the in-flight handler and starts no queued work during shutdown', async () => {
    const queue = createInMemoryQueue();
    const handlerStarted = deferred();
    const releaseHandler = deferred();
    const handled = [];
    await queue.publish(firstMessage);
    await queue.publish(secondMessage);
    const consuming = queue.consume(async (message) => {
      handled.push(message.messageId);
      handlerStarted.resolve();
      await releaseHandler.promise;
    });
    await handlerStarted.promise;

    const shuttingDown = queue.shutdown();
    releaseHandler.resolve();
    await shuttingDown;
    await consuming;

    expect(handled).toEqual(['message-1']);
    await expect(queue.publish({ messageId: 'message-3' })).rejects.toMatchObject({
      code: 'QUEUE_SHUTDOWN',
    });
  });
});
