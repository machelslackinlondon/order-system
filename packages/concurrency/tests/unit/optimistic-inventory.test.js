import { describe, expect, it } from '@jest/globals';

import * as concurrency from '../../src/index.js';

const PRODUCT_ID = 'keyboard';

function product(overrides = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Mechanical Keyboard',
    stock: 10,
    version: 1,
    ...overrides,
  };
}

describe('optimistic inventory reservation', () => {
  it('reads fresh inventory and retries after a version conflict', async () => {
    let current = product();
    let conflictPending = true;
    const productRepository = {
      async findById() {
        return { ...current };
      },
      async reserveWithVersion({ quantity, expectedVersion }) {
        if (conflictPending) {
          conflictPending = false;
          current = product({ stock: 9, version: 2 });
          return null;
        }

        if (expectedVersion !== current.version) {
          return null;
        }

        current = { ...current, stock: current.stock - quantity, version: current.version + 1 };
        return { ...current };
      },
    };

    expect(concurrency.createOptimisticInventoryReservation).toEqual(expect.any(Function));

    const reserve = concurrency.createOptimisticInventoryReservation({ productRepository });

    await expect(reserve({ productId: PRODUCT_ID, quantity: 3 })).resolves.toEqual(
      product({ stock: 6, version: 3 }),
    );
  });

  it('rejects insufficient stock without attempting an update', async () => {
    const productRepository = {
      async findById() {
        return product({ stock: 2 });
      },
      async reserveWithVersion() {
        throw new Error('inventory update must not run');
      },
    };

    expect(concurrency.createOptimisticInventoryReservation).toEqual(expect.any(Function));

    const reserve = concurrency.createOptimisticInventoryReservation({ productRepository });

    await expect(reserve({ productId: PRODUCT_ID, quantity: 3 })).rejects.toMatchObject({
      name: 'InsufficientInventoryError',
      code: 'INSUFFICIENT_INVENTORY',
      productId: PRODUCT_ID,
    });
  });

  it.each([0, -1, 1.5])('rejects invalid reservation quantity %s', async (quantity) => {
    const productRepository = {
      async findById() {
        throw new Error('inventory read must not run');
      },
      async reserveWithVersion() {
        throw new Error('inventory update must not run');
      },
    };

    const reserve = concurrency.createOptimisticInventoryReservation({ productRepository });

    await expect(reserve({ productId: PRODUCT_ID, quantity })).rejects.toMatchObject({
      name: 'InvalidInventoryQuantityError',
      code: 'INVALID_INVENTORY_QUANTITY',
      quantity,
    });
  });

  it('reports a typed error when inventory does not exist', async () => {
    const productRepository = {
      async findById() {
        return null;
      },
      async reserveWithVersion() {
        throw new Error('inventory update must not run');
      },
    };

    const reserve = concurrency.createOptimisticInventoryReservation({ productRepository });

    await expect(reserve({ productId: PRODUCT_ID, quantity: 3 })).rejects.toMatchObject({
      name: 'InventoryProductNotFoundError',
      code: 'INVENTORY_PRODUCT_NOT_FOUND',
      productId: PRODUCT_ID,
    });
  });

  it('stops after the configured number of conflict retries', async () => {
    let attempts = 0;
    const productRepository = {
      async findById() {
        return product({ version: attempts + 1 });
      },
      async reserveWithVersion() {
        attempts += 1;
        return null;
      },
    };

    expect(concurrency.createOptimisticInventoryReservation).toEqual(expect.any(Function));

    const reserve = concurrency.createOptimisticInventoryReservation({
      productRepository,
      maxRetries: 2,
    });

    await expect(reserve({ productId: PRODUCT_ID, quantity: 3 })).rejects.toMatchObject({
      name: 'OptimisticRetriesExhaustedError',
      code: 'OPTIMISTIC_RETRIES_EXHAUSTED',
      attempts: 3,
      productId: PRODUCT_ID,
    });
    expect(attempts).toBe(3);
  });

  it('allows zero retries and makes one reservation attempt', async () => {
    let attempts = 0;
    const productRepository = {
      async findById() {
        return product();
      },
      async reserveWithVersion() {
        attempts += 1;
        return null;
      },
    };

    const reserve = concurrency.createOptimisticInventoryReservation({
      productRepository,
      maxRetries: 0,
    });

    await expect(reserve({ productId: PRODUCT_ID, quantity: 3 })).rejects.toMatchObject({
      name: 'OptimisticRetriesExhaustedError',
      attempts: 1,
    });
    expect(attempts).toBe(1);
  });

  it.each([-1, 1.5, Number.NaN, '2'])('rejects invalid maxRetries value %s', (maxRetries) => {
    expect(() =>
      concurrency.createOptimisticInventoryReservation({
        productRepository: {},
        maxRetries,
      }),
    ).toThrow('maxRetries must be a non-negative integer');
  });
});
