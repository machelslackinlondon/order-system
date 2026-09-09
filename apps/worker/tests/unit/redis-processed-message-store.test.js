import { describe, expect, it } from '@jest/globals';

import * as worker from '../../src/index.js';

function createInMemoryRedis() {
  const entries = new Map();
  let nowSeconds = 0;

  function currentEntry(key) {
    const entry = entries.get(key);

    if (entry?.expiresAt !== undefined && entry.expiresAt <= nowSeconds) {
      entries.delete(key);
      return undefined;
    }

    return entry;
  }

  return {
    async set(key, value, options = {}) {
      if (options.condition === 'NX' && currentEntry(key)) {
        return null;
      }

      const ttlSeconds = options.expiration?.type === 'EX' ? options.expiration.value : undefined;
      const expiresAt = ttlSeconds === undefined ? undefined : nowSeconds + ttlSeconds;
      entries.set(key, { value, expiresAt });
      return 'OK';
    },

    advanceSeconds(seconds) {
      nowSeconds += seconds;
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

  it('allows a message to be claimed again after its TTL expires', async () => {
    const client = createInMemoryRedis();
    const store = processedMessageStore(client);
    const claim = { consumer: 'inventory', messageId: 'message-1', ttlSeconds: 60 };

    await expect(store.tryClaim(claim)).resolves.toBe(true);
    await expect(store.tryClaim(claim)).resolves.toBe(false);

    client.advanceSeconds(60);

    await expect(store.tryClaim(claim)).resolves.toBe(true);
  });
});
