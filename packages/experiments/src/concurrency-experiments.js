import {
  createOptimisticInventoryReservation,
  reserveInventoryUnsafe,
} from '@order-system/concurrency';
import { createRedisLock } from '@order-system/locks';

async function runRaceCondition() {
  let stock = 10;
  const inventory = {
    async getStock() {
      return stock;
    },
    async updateStock(_productId, nextStock) {
      stock = nextStock;
    },
  };
  const accepted = await Promise.all([
    reserveInventoryUnsafe(inventory, 'keyboard', 3),
    reserveInventoryUnsafe(inventory, 'keyboard', 3),
  ]);

  return {
    observations: [
      `Accepted reservations: ${accepted.filter(Boolean).length}`,
      'Expected stock: 4',
      `Actual stock: ${stock}`,
    ],
    conclusion: 'A lost update kept only one of two accepted reservations.',
  };
}

async function runOptimisticLock() {
  let product = { id: 'keyboard', name: 'Mechanical Keyboard', stock: 10, version: 1 };
  let attempts = 0;
  const reserve = createOptimisticInventoryReservation({
    productRepository: {
      async findById() {
        return { ...product };
      },
      async reserveWithVersion({ quantity, expectedVersion }) {
        attempts += 1;
        if (attempts === 1) {
          product = { ...product, stock: 9, version: 2 };
          return null;
        }
        if (expectedVersion !== product.version) {
          return null;
        }
        product = { ...product, stock: product.stock - quantity, version: product.version + 1 };
        return { ...product };
      },
    },
  });

  await reserve({ productId: product.id, quantity: 3 });
  return {
    observations: [
      `Reservation attempts: ${attempts}`,
      `Final stock: ${product.stock}`,
      `Final version: ${product.version}`,
    ],
    conclusion: 'The stale version conflicted, then a fresh read allowed a safe retry.',
  };
}

async function runPessimisticLock() {
  let stock = 10;
  let lockTail = Promise.resolve();
  const completionOrder = [];

  async function reserve(orderId) {
    const predecessor = lockTail;
    let release;
    lockTail = new Promise((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      await Promise.resolve();
      stock -= 3;
      completionOrder.push(orderId);
    } finally {
      release();
    }
  }

  await Promise.all([reserve('order-1'), reserve('order-2')]);
  return {
    observations: [`Completion order: ${completionOrder.join(', ')}`, `Final stock: ${stock}`],
    conclusion: 'Exclusive access serialized both reservations and preserved every update.',
  };
}

async function runIdempotency() {
  const results = new Map();
  let ordersCreated = 0;

  async function createOrder(idempotencyKey) {
    if (!results.has(idempotencyKey)) {
      ordersCreated += 1;
      results.set(idempotencyKey, { id: `order-${ordersCreated}` });
    }
    return results.get(idempotencyKey);
  }

  const orders = await Promise.all([
    createOrder('checkout-123'),
    createOrder('checkout-123'),
    createOrder('checkout-123'),
  ]);

  return {
    observations: [
      `Requests: ${orders.length}`,
      `Orders created: ${ordersCreated}`,
      `Returned order IDs: ${[...new Set(orders.map(({ id }) => id))].join(', ')}`,
    ],
    conclusion: 'Every retry resolved to the single result stored for its idempotency key.',
  };
}

async function runDistributedLock() {
  let storedLease;
  const client = {
    async set(key, token) {
      if (storedLease) {
        return null;
      }
      storedLease = { key, token };
      return 'OK';
    },
    async eval(_script, { keys: [key], arguments: [token] }) {
      if (storedLease?.key !== key || storedLease.token !== token) {
        return 0;
      }
      storedLease = undefined;
      return 1;
    },
  };
  const first = createRedisLock({ client, tokenFactory: () => 'worker-1-token' });
  const second = createRedisLock({ client, tokenFactory: () => 'worker-2-token' });
  const leases = await Promise.all([
    first.acquire('inventory:keyboard', { ttlMs: 1_000 }),
    second.acquire('inventory:keyboard', { ttlMs: 1_000 }),
  ]);
  const acquired = leases.filter(Boolean);
  const released = await first.release(acquired[0]);

  return {
    observations: [
      `Acquired leases: ${acquired.length}`,
      `Second owner acquired: ${leases[1] !== null}`,
      `Released by owner: ${released}`,
    ],
    conclusion: 'A token-owned lease admitted one owner and rejected its contender.',
  };
}

export function createConcurrencyExperiments() {
  return new Map([
    [
      'race-condition',
      {
        title: 'Lost inventory update',
        demonstrates: 'Concurrent read-modify-write can discard a valid stock reservation.',
        source: 'packages/concurrency/src/index.js',
        commits: ['3c03007', 'be69c50'],
        run: runRaceCondition,
      },
    ],
    [
      'optimistic-lock',
      {
        title: 'Optimistic inventory locking',
        demonstrates: 'Version conflicts force a bounded retry from fresh state.',
        source: 'packages/concurrency/src/index.js',
        commits: ['8649cc0', 'c47d18c'],
        run: runOptimisticLock,
      },
    ],
    [
      'pessimistic-lock',
      {
        title: 'Pessimistic inventory locking',
        demonstrates: 'Exclusive access serializes competing inventory updates.',
        source: 'packages/concurrency/src/index.js',
        commits: ['01a9d48', 'af57639'],
        run: runPessimisticLock,
      },
    ],
    [
      'idempotency',
      {
        title: 'Retry-safe order creation',
        demonstrates: 'One idempotency key resolves repeated requests to one order.',
        source: 'apps/api/src/order-idempotency.js',
        commits: ['9845f99', '0d8be61'],
        run: runIdempotency,
      },
    ],
    [
      'distributed-lock',
      {
        title: 'Token-owned distributed lock',
        demonstrates: 'A shared lease admits one owner and rejects concurrent contenders.',
        source: 'packages/locks/src/index.js',
        commits: ['dd3cff3', '642cadd'],
        run: runDistributedLock,
      },
    ],
  ]);
}
