import { describe, expect, it } from '@jest/globals';

import * as concurrency from '../../src/index.js';

describe('unsafe inventory reservation experiment', () => {
  it('demonstrates lost updates when inventory reservations run concurrently', async () => {
    expect(concurrency.reserveInventoryUnsafe).toEqual(expect.any(Function));

    let stock = 10;
    const inventory = {
      async getStock() {
        return stock;
      },
      async updateStock(_productId, nextStock) {
        stock = nextStock;
      },
    };

    const outcomes = await Promise.all([
      concurrency.reserveInventoryUnsafe(inventory, 'keyboard', 3),
      concurrency.reserveInventoryUnsafe(inventory, 'keyboard', 3),
    ]);

    expect(outcomes).toEqual([true, true]);
    expect(stock).toBe(7);
    expect(stock).not.toBe(4);
  });
});
