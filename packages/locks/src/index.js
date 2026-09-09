import { randomUUID } from 'node:crypto';

const releaseScript = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

export class InvalidLockTtlError extends RangeError {
  constructor() {
    super('Lock TTL must be a positive integer');
    this.name = 'InvalidLockTtlError';
    this.code = 'INVALID_LOCK_TTL';
  }
}

export class RedisLockUnavailableError extends Error {
  constructor({ operation, cause }) {
    super(`Redis lock ${operation.toLowerCase()} failed`, { cause });
    this.name = 'RedisLockUnavailableError';
    this.code = 'REDIS_LOCK_UNAVAILABLE';
    this.operation = operation;
  }
}

export function createRedisLock({
  client,
  keyPrefix = 'order-system:lock:',
  tokenFactory = randomUUID,
}) {
  function key(resource) {
    return `${keyPrefix}${resource}`;
  }

  return {
    async acquire(resource, { ttlMs }) {
      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
        throw new InvalidLockTtlError();
      }

      const token = tokenFactory();
      let acquired;

      try {
        acquired = await client.set(key(resource), token, {
          condition: 'NX',
          expiration: { type: 'PX', value: ttlMs },
        });
      } catch (cause) {
        throw new RedisLockUnavailableError({ operation: 'ACQUIRE', cause });
      }

      return acquired === 'OK' ? { resource, token, ttlMs } : null;
    },

    async release(lease) {
      let released;

      try {
        released = await client.eval(releaseScript, {
          keys: [key(lease.resource)],
          arguments: [lease.token],
        });
      } catch (cause) {
        throw new RedisLockUnavailableError({ operation: 'RELEASE', cause });
      }

      return released === 1;
    },
  };
}
