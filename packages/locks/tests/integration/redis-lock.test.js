import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createClient } from 'redis';

const lockApi = import('../../src/index.js');
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

function silentClient(options = {}) {
  const client = createClient(options);
  client.on('error', () => undefined);
  return client;
}

async function acquireAfterExpiry(lock, resource, ttlMs) {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const lease = await lock.acquire(resource, { ttlMs });
    if (lease) {
      return lease;
    }
    await delay(10);
  }

  throw new Error('Lock did not expire before the test deadline');
}

describe('Redis distributed lock', () => {
  let firstClient;
  let secondClient;

  beforeAll(async () => {
    firstClient = silentClient({ url: redisUrl });
    secondClient = silentClient({ url: redisUrl });
    await Promise.all([firstClient.connect(), secondClient.connect()]);
  });

  beforeEach(async () => {
    await firstClient.flushDb();
  });

  afterAll(async () => {
    await Promise.all([firstClient.close(), secondClient.close()]);
  });

  it('acquires an owned lock with a finite TTL', async () => {
    const { createRedisLock } = await lockApi;
    const lock = createRedisLock({
      client: firstClient,
      keyPrefix: 'test-lock:',
      tokenFactory: () => 'worker-a-token',
    });

    await expect(lock.acquire('inventory:product-1', { ttlMs: 500 })).resolves.toEqual({
      resource: 'inventory:product-1',
      token: 'worker-a-token',
      ttlMs: 500,
    });
    await expect(firstClient.get('test-lock:inventory:product-1')).resolves.toBe('worker-a-token');
    const remainingTtl = await firstClient.pTTL('test-lock:inventory:product-1');
    expect(remainingTtl).toBeGreaterThan(0);
    expect(remainingTtl).toBeLessThanOrEqual(500);
  });

  it('returns no lease when another owner holds the resource', async () => {
    const { createRedisLock } = await lockApi;
    const firstWorker = createRedisLock({
      client: firstClient,
      tokenFactory: () => 'worker-a-token',
    });
    const secondWorker = createRedisLock({
      client: secondClient,
      tokenFactory: () => 'worker-b-token',
    });
    await firstWorker.acquire('order:123', { ttlMs: 1_000 });

    await expect(secondWorker.acquire('order:123', { ttlMs: 1_000 })).resolves.toBeNull();
  });

  it('allows only one of two workers to acquire the same resource', async () => {
    const { createRedisLock } = await lockApi;
    const firstWorker = createRedisLock({
      client: firstClient,
      tokenFactory: () => 'worker-a-token',
    });
    const secondWorker = createRedisLock({
      client: secondClient,
      tokenFactory: () => 'worker-b-token',
    });

    const leases = await Promise.all([
      firstWorker.acquire('order:123', { ttlMs: 1_000 }),
      secondWorker.acquire('order:123', { ttlMs: 1_000 }),
    ]);

    expect(leases.filter(Boolean)).toHaveLength(1);
    expect(leases.filter((lease) => lease === null)).toHaveLength(1);
  });

  it('releases a lock owned by the supplied token', async () => {
    const { createRedisLock } = await lockApi;
    const lock = createRedisLock({
      client: firstClient,
      tokenFactory: () => 'worker-a-token',
    });
    const lease = await lock.acquire('order:123', { ttlMs: 1_000 });

    await expect(lock.release(lease)).resolves.toBe(true);
    await expect(firstClient.exists('order-system:lock:order:123')).resolves.toBe(0);
  });

  it('does not release a lock owned by another token', async () => {
    const { createRedisLock } = await lockApi;
    const owner = createRedisLock({
      client: firstClient,
      tokenFactory: () => 'worker-a-token',
    });
    const otherWorker = createRedisLock({ client: secondClient });
    await owner.acquire('order:123', { ttlMs: 1_000 });

    await expect(
      otherWorker.release({
        resource: 'order:123',
        token: 'worker-b-token',
        ttlMs: 1_000,
      }),
    ).resolves.toBe(false);
    await expect(firstClient.get('order-system:lock:order:123')).resolves.toBe('worker-a-token');
  });

  it('does not let an expired owner release a replacement lock', async () => {
    const { createRedisLock } = await lockApi;
    const expiredOwner = createRedisLock({
      client: firstClient,
      tokenFactory: () => 'expired-owner-token',
    });
    const replacementOwner = createRedisLock({
      client: secondClient,
      tokenFactory: () => 'replacement-owner-token',
    });
    const expiredLease = await expiredOwner.acquire('order:123', { ttlMs: 50 });

    const replacementLease = await acquireAfterExpiry(replacementOwner, 'order:123', 1_000);

    expect(replacementLease).toEqual({
      resource: 'order:123',
      token: 'replacement-owner-token',
      ttlMs: 1_000,
    });
    await expect(expiredOwner.release(expiredLease)).resolves.toBe(false);
    await expect(firstClient.get('order-system:lock:order:123')).resolves.toBe(
      'replacement-owner-token',
    );
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid TTL %p before contacting Redis',
    async (ttlMs) => {
      const { createRedisLock } = await lockApi;
      const lock = createRedisLock({ client: firstClient });

      await expect(lock.acquire('order:123', { ttlMs })).rejects.toMatchObject({
        code: 'INVALID_LOCK_TTL',
      });
      await expect(firstClient.exists('order-system:lock:order:123')).resolves.toBe(0);
    },
  );

  it('surfaces Redis unavailability without reporting lock contention', async () => {
    const { createRedisLock } = await lockApi;
    const unavailableClient = silentClient({
      url: 'redis://127.0.0.1:6399',
      socket: { connectTimeout: 100, reconnectStrategy: false },
    });
    await unavailableClient.connect().catch(() => undefined);
    const lock = createRedisLock({ client: unavailableClient });

    await expect(lock.acquire('order:123', { ttlMs: 1_000 })).rejects.toMatchObject({
      code: 'REDIS_LOCK_UNAVAILABLE',
      operation: 'ACQUIRE',
      cause: expect.any(Error),
    });

    if (unavailableClient.isOpen) {
      unavailableClient.destroy();
    }
  });
});
