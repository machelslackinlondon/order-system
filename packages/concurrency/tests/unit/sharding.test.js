import { describe, expect, it } from '@jest/globals';

import * as concurrency from '../../src/index.js';

const partitionIds = ['partition-1', 'partition-2', 'partition-3'];

function createRouter(ids = partitionIds) {
  expect(concurrency.createOrderPartitionRouter).toEqual(expect.any(Function));
  return concurrency.createOrderPartitionRouter({ partitionIds: ids });
}

describe('order partition routing', () => {
  it('routes a customer to a deterministic partition', () => {
    const router = createRouter();

    expect(router.route({ customerId: 'customer-123' })).toBe('partition-3');
  });

  it('co-locates orders belonging to the same customer', () => {
    const router = createRouter();

    expect(router.route({ id: 'order-1', customerId: 'customer-123', productId: 'product-a' })).toBe(
      'partition-3',
    );
    expect(router.route({ id: 'order-2', customerId: 'customer-123', productId: 'product-b' })).toBe(
      'partition-3',
    );
  });

  it('spreads selected customer keys across the configured partitions', () => {
    const router = createRouter();

    expect(router.route({ customerId: 'customer-a' })).toBe('partition-3');
    expect(router.route({ customerId: 'customer-b' })).toBe('partition-2');
    expect(router.route({ customerId: 'customer-c' })).toBe('partition-1');
  });

  it('demonstrates an uneven distribution when one customer dominates traffic', () => {
    const router = createRouter();
    const routedPartitions = Array.from({ length: 6 }, () =>
      router.route({ customerId: 'customer-hot' }),
    );

    expect(routedPartitions).toEqual(Array(6).fill('partition-1'));
  });

  it.each([
    { label: 'a non-array list', ids: 'partition-1' },
    { label: 'too few partitions', ids: ['partition-1'] },
    { label: 'duplicate IDs', ids: ['partition-1', 'partition-1'] },
    { label: 'an empty ID', ids: ['partition-1', ''] },
    { label: 'a non-string ID', ids: ['partition-1', 2] },
  ])('rejects a topology with $label', ({ ids }) => {
    expect(() => createRouter(ids)).toThrow(
      'Partition router requires at least two distinct non-empty partition IDs',
    );
  });

  it('rejects a topology with a missing partition list', () => {
    expect(() => concurrency.createOrderPartitionRouter({})).toThrow(
      'Partition router requires at least two distinct non-empty partition IDs',
    );
  });

  it.each([
    { label: 'a null order', order: null },
    { label: 'a missing customer ID', order: { id: 'order-1' } },
    { label: 'an empty customer ID', order: { customerId: '' } },
    { label: 'a non-string customer ID', order: { customerId: 123 } },
  ])('rejects $label', ({ order }) => {
    const router = createRouter();

    expect(() => router.route(order)).toThrow('Order must have a non-empty string customer ID');
  });
});
