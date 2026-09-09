import { describe, expect, it } from '@jest/globals';

import * as worker from '../../src/index.js';

function createInMemoryRedis() {
  const entries = new Map();

  return {
    async set(key, value, options = {}) {
      if (options.condition === 'NX' && entries.has(key)) {
        return null;
      }

      const ttlSeconds =
        options.expiration?.type === 'EX' ? options.expiration.value : undefined;
      entries.set(key, { value, ttlSeconds });
      return 'OK';
    },

    async ttl(key) {
      return entries.get(key)?.ttlSeconds ?? -1;
    },
  };
}

function processedMessageStore(client) {
  expect(worker.createRedisProcessedMessageStore).toEqual(expect.any(Function));
  return worker.createRedisProcessedMessageStore({ client });
}

describe('Redis processed-message store', () => {
  it('allows one concurrent claim for the same consumer and message', async () => {
    const client = createInMemoryRedis();
    const firstStore = processedMessageStore(client);
    const secondStore = processedMessageStore(client);
    const claim = {
      consumer: 'inventory',
      messageId: 'message-1',
      ttlSeconds: 60,
    };

    const claims = await Promise.all([firstStore.tryClaim(claim), secondStore.tryClaim(claim)]);

    expect(claims.sort()).toEqual([false, true]);
  });

  it('isolates the same message between independent consumers', async () => {
    const client = createInMemoryRedis();
    const store = processedMessageStore(client);

    await expect(
      Promise.all([
        store.tryClaim({ consumer: 'inventory', messageId: 'message-1', ttlSeconds: 60 }),
        store.tryClaim({ consumer: 'notifications', messageId: 'message-1', ttlSeconds: 60 }),
      ]),
    ).resolves.toEqual([true, true]);
  });

  it('sets an expiry on a successful claim', async () => {
    const client = createInMemoryRedis();
    const store = processedMessageStore(client);

    await store.tryClaim({ consumer: 'inventory', messageId: 'message-1', ttlSeconds: 60 });

    await expect(client.ttl('order-system:processed-message:inventory:message-1')).resolves.toBe(
      60,
    );
  });
});
