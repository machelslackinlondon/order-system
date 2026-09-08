import { describe, expect, it } from '@jest/globals';
import { createInMemoryQueue } from '../../src/index.js';

function message(id) {
  return { messageId: id, type: 'ORDER_CREATED' };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('in-memory queue backpressure', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects invalid capacity %p', (capacity) => {
    expect(() => createInMemoryQueue({ capacity })).toThrow(
      expect.objectContaining({ code: 'INVALID_QUEUE_CAPACITY' }),
    );
  });

  it('rejects an unsupported overflow strategy', () => {
    expect(() => createInMemoryQueue({ capacity: 1, overflowStrategy: 'drop' })).toThrow(
      expect.objectContaining({ code: 'INVALID_OVERFLOW_STRATEGY' }),
    );
  });

  it('rejects excess work without discarding accepted messages', async () => {
    const queue = createInMemoryQueue({ capacity: 2 });
    await queue.publish(message('message-1'));
    await queue.publish(message('message-2'));

    await expect(queue.publish(message('message-3'))).rejects.toMatchObject({
      code: 'QUEUE_CAPACITY_EXCEEDED',
    });
    expect(queue.getMetrics()).toEqual({
      capacity: 2,
      queueDepth: 2,
      waitingPublishers: 0,
    });

    const handled = [];
    const acceptedHandled = deferred();
    const consuming = queue.consume(async (acceptedMessage) => {
      handled.push(acceptedMessage.messageId);
      if (handled.length === 2) {
        acceptedHandled.resolve();
      }
    });
    await acceptedHandled.promise;

    expect(handled).toEqual(['message-1', 'message-2']);
    await queue.shutdown();
    await consuming;
  });

  it('waits for acknowledged work to free capacity when configured', async () => {
    const queue = createInMemoryQueue({ capacity: 1, overflowStrategy: 'wait' });
    await queue.publish(message('message-1'));
    let secondAdmitted = false;
    const secondPublished = queue.publish(message('message-2')).then(() => {
      secondAdmitted = true;
    });
    await Promise.resolve();

    expect(secondAdmitted).toBe(false);
    expect(queue.getMetrics()).toEqual({
      capacity: 1,
      queueDepth: 1,
      waitingPublishers: 1,
    });

    const firstStarted = deferred();
    const releaseFirst = deferred();
    const secondHandled = deferred();
    const handled = [];
    const consuming = queue.consume(async (acceptedMessage) => {
      handled.push(acceptedMessage.messageId);
      if (acceptedMessage.messageId === 'message-1') {
        firstStarted.resolve();
        await releaseFirst.promise;
      } else {
        secondHandled.resolve();
      }
    });
    await firstStarted.promise;
    expect(secondAdmitted).toBe(false);

    releaseFirst.resolve();
    await secondPublished;
    await secondHandled.promise;

    expect(handled).toEqual(['message-1', 'message-2']);
    await queue.shutdown();
    await consuming;
  });

  it('keeps a waiting producer blocked until a failed message is later acknowledged', async () => {
    const queue = createInMemoryQueue({ capacity: 1, overflowStrategy: 'wait' });
    await queue.publish(message('message-1'));
    let secondAdmitted = false;
    const secondPublished = queue.publish(message('message-2')).then(() => {
      secondAdmitted = true;
    });
    const processingError = new Error('processing failed');

    await expect(
      queue.consume(async () => {
        throw processingError;
      }),
    ).rejects.toBe(processingError);

    expect(secondAdmitted).toBe(false);
    expect(queue.getMetrics()).toMatchObject({ queueDepth: 1, waitingPublishers: 1 });

    const attempts = [];
    const secondHandled = deferred();
    const consuming = queue.consume(async (acceptedMessage) => {
      attempts.push(acceptedMessage.messageId);
      if (acceptedMessage.messageId === 'message-2') {
        secondHandled.resolve();
      }
    });
    await secondPublished;
    await secondHandled.promise;

    expect(attempts).toEqual(['message-1', 'message-2']);
    await queue.shutdown();
    await consuming;
  });

  it('admits waiting producers in first-in-first-out order', async () => {
    const queue = createInMemoryQueue({ capacity: 1, overflowStrategy: 'wait' });
    const admissions = [];
    await queue.publish(message('message-1'));
    const secondPublished = queue.publish(message('message-2')).then(() => admissions.push(2));
    const thirdPublished = queue.publish(message('message-3')).then(() => admissions.push(3));

    expect(queue.getMetrics()).toMatchObject({ queueDepth: 1, waitingPublishers: 2 });

    const handled = [];
    const allHandled = deferred();
    const consuming = queue.consume(async (acceptedMessage) => {
      handled.push(acceptedMessage.messageId);
      if (handled.length === 3) {
        allHandled.resolve();
      }
    });
    await Promise.all([secondPublished, thirdPublished, allHandled.promise]);

    expect(admissions).toEqual([2, 3]);
    expect(handled).toEqual(['message-1', 'message-2', 'message-3']);
    await queue.shutdown();
    await consuming;
  });

  it('rejects waiting producers during shutdown', async () => {
    const queue = createInMemoryQueue({ capacity: 1, overflowStrategy: 'wait' });
    await queue.publish(message('message-1'));
    const waitingOutcome = Promise.allSettled([queue.publish(message('message-2'))]);
    await Promise.resolve();

    await queue.shutdown();

    await expect(waitingOutcome).resolves.toEqual([
      {
        status: 'rejected',
        reason: expect.objectContaining({ code: 'QUEUE_SHUTDOWN' }),
      },
    ]);
    expect(queue.getMetrics()).toMatchObject({ waitingPublishers: 0 });
  });

  it('does not start queued work after shutdown begins', async () => {
    const queue = createInMemoryQueue({ capacity: 1 });
    await queue.publish(message('message-1'));
    const handled = [];

    const consuming = queue.consume(async (acceptedMessage) => {
      handled.push(acceptedMessage.messageId);
    });
    await queue.shutdown();
    await consuming;

    expect(handled).toEqual([]);
  });
});
