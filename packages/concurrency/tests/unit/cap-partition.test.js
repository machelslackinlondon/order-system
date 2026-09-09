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

  it('rejects unsupported partition policies instead of silently choosing a trade-off', () => {
    expect(() =>
      concurrency.simulatePartitionedInventory({
        policy: 'CA',
        initialStock: 5,
        reservations: partitionedReservations,
      }),
    ).toThrow('Partition policy must be CP or AP');
  });

  it.each([-1, 1.5, Number.NaN])('rejects invalid initial stock %p', (initialStock) => {
    expect(() =>
      concurrency.simulatePartitionedInventory({
        policy: 'AP',
        initialStock,
        reservations: partitionedReservations,
      }),
    ).toThrow('Initial stock must be a non-negative integer');
  });

  it.each([
    { label: 'one reservation', reservations: partitionedReservations.slice(0, 1) },
    {
      label: 'three reservations',
      reservations: [
        ...partitionedReservations,
        { orderId: 'order-paris', replica: 'paris', quantity: 1 },
      ],
    },
  ])('rejects a scenario containing $label', ({ reservations }) => {
    expect(() =>
      concurrency.simulatePartitionedInventory({
        policy: 'AP',
        initialStock: 5,
        reservations,
      }),
    ).toThrow('Partition simulation requires exactly two reservations');
  });

  it('rejects duplicate replica identifiers', () => {
    expect(() =>
      concurrency.simulatePartitionedInventory({
        policy: 'AP',
        initialStock: 5,
        reservations: [
          partitionedReservations[0],
          { ...partitionedReservations[1], replica: 'london' },
        ],
      }),
    ).toThrow('Partition simulation requires two distinct replicas');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid reservation quantity %p', (quantity) => {
    expect(() =>
      concurrency.simulatePartitionedInventory({
        policy: 'AP',
        initialStock: 5,
        reservations: [{ ...partitionedReservations[0], quantity }, partitionedReservations[1]],
      }),
    ).toThrow('Reservation quantities must be positive integers');
  });
});
