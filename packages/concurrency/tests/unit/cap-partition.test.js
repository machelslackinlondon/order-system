import { describe, expect, it } from '@jest/globals';

import * as concurrency from '../../src/index.js';

const partitionedReservations = [
  { orderId: 'order-london', replica: 'london', quantity: 3 },
  { orderId: 'order-frankfurt', replica: 'frankfurt', quantity: 3 },
];

describe('CAP inventory partition simulation', () => {
  it('preserves consistency by rejecting writes that cannot reach the authority', () => {
    expect(concurrency.simulatePartitionedInventory).toEqual(expect.any(Function));

    expect(
      concurrency.simulatePartitionedInventory({
        policy: 'CP',
        initialStock: 5,
        reservations: partitionedReservations,
      }),
    ).toEqual({
      policy: 'CP',
      acceptedOrderIds: [],
      rejectedOrderIds: ['order-london', 'order-frankfurt'],
      replicaStock: { london: 5, frankfurt: 5 },
      totalAcceptedQuantity: 0,
      availabilityPreserved: false,
      consistencyPreserved: true,
    });
  });

  it('preserves availability by accepting local writes that conflict after reconciliation', () => {
    expect(concurrency.simulatePartitionedInventory).toEqual(expect.any(Function));

    expect(
      concurrency.simulatePartitionedInventory({
        policy: 'AP',
        initialStock: 5,
        reservations: partitionedReservations,
      }),
    ).toEqual({
      policy: 'AP',
      acceptedOrderIds: ['order-london', 'order-frankfurt'],
      rejectedOrderIds: [],
      replicaStock: { london: 2, frankfurt: 2 },
      totalAcceptedQuantity: 6,
      availabilityPreserved: true,
      consistencyPreserved: false,
    });
  });
});
