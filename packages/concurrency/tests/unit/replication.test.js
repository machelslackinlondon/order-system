import { describe, expect, it } from '@jest/globals';

import * as concurrency from '../../src/index.js';

const replicas = ['replica-1', 'replica-2'];
const pendingOrder = {
  id: 'order-123',
  customerId: 'customer-123',
  status: 'PENDING',
  amount: 12_500,
};
const pendingRecord = { ...pendingOrder, version: 1 };
const confirmedRecord = { ...pendingOrder, status: 'CONFIRMED', version: 2 };

function createSimulation() {
  expect(concurrency.createOrderReplicationSimulation).toEqual(expect.any(Function));
  return concurrency.createOrderReplicationSimulation({ replicaIds: replicas });
}

describe('order replication simulation', () => {
  it('reads the latest committed version from the primary immediately', () => {
    const simulation = createSimulation();

    simulation.writePrimary(pendingOrder);
    simulation.writePrimary({ ...pendingOrder, status: 'CONFIRMED' });

    expect(simulation.readPrimary('order-123')).toEqual(confirmedRecord);
  });

  it('keeps replicas stale until their own replication queue advances', () => {
    const simulation = createSimulation();
    simulation.writePrimary(pendingOrder);

    expect(simulation.readReplica('replica-1', 'order-123')).toBeNull();
    expect(simulation.readReplica('replica-2', 'order-123')).toBeNull();

    expect(simulation.replicateNext('replica-1')).toEqual(pendingRecord);
    expect(simulation.readReplica('replica-1', 'order-123')).toEqual(pendingRecord);
    expect(simulation.readReplica('replica-2', 'order-123')).toBeNull();
  });

  it('demonstrates a stale replica read immediately after a primary update', () => {
    const simulation = createSimulation();
    simulation.writePrimary(pendingOrder);
    simulation.replicateNext('replica-1');

    simulation.writePrimary({ ...pendingOrder, status: 'CONFIRMED' });

    expect(simulation.readPrimary('order-123')).toEqual(confirmedRecord);
    expect(simulation.readReplica('replica-1', 'order-123')).toEqual(pendingRecord);
  });

  it('lets replicas converge independently after queued changes are replayed', () => {
    const simulation = createSimulation();
    simulation.writePrimary(pendingOrder);
    simulation.writePrimary({ ...pendingOrder, status: 'CONFIRMED' });

    simulation.replicateNext('replica-1');
    simulation.replicateNext('replica-1');
    simulation.replicateNext('replica-2');

    expect(simulation.readReplica('replica-1', 'order-123')).toEqual(confirmedRecord);
    expect(simulation.readReplica('replica-2', 'order-123')).toEqual(pendingRecord);

    expect(simulation.replicateNext('replica-2')).toEqual(confirmedRecord);
    expect(simulation.readReplica('replica-2', 'order-123')).toEqual(confirmedRecord);
    expect(simulation.replicateNext('replica-2')).toBeNull();
  });

  it.each([
    { label: 'too few IDs', replicaIds: ['replica-1'] },
    { label: 'duplicate IDs', replicaIds: ['replica-1', 'replica-1'] },
    { label: 'an empty ID', replicaIds: ['replica-1', ''] },
    { label: 'a non-string ID', replicaIds: ['replica-1', 2] },
  ])('rejects a topology with $label', ({ replicaIds }) => {
    expect(() => concurrency.createOrderReplicationSimulation({ replicaIds })).toThrow(
      'Replication simulation requires two distinct non-empty replica IDs',
    );
  });

  it('rejects reads from an unconfigured replica', () => {
    const simulation = createSimulation();

    expect(() => simulation.readReplica('replica-3', 'order-123')).toThrow(
      'Unknown replica ID: replica-3',
    );
  });

  it('rejects replay for an unconfigured replica', () => {
    const simulation = createSimulation();

    expect(() => simulation.replicateNext('replica-3')).toThrow('Unknown replica ID: replica-3');
  });

  it.each([
    { label: 'a null value', order: null },
    { label: 'a missing ID', order: { status: 'PENDING' } },
    { label: 'an empty ID', order: { id: '', status: 'PENDING' } },
    { label: 'a non-string ID', order: { id: 123, status: 'PENDING' } },
  ])('rejects an invalid primary order with $label', ({ order }) => {
    const simulation = createSimulation();

    expect(() => simulation.writePrimary(order)).toThrow(
      'Replicated order must have a non-empty string ID',
    );
  });

  it('isolates primary and replica records from nested caller mutations', () => {
    const simulation = createSimulation();
    const order = { ...pendingOrder, audit: { actor: 'customer' } };

    const written = simulation.writePrimary(order);
    order.audit.actor = 'mutated-input';
    written.audit.actor = 'mutated-write';

    expect(simulation.readPrimary('order-123')).toEqual({
      ...pendingRecord,
      audit: { actor: 'customer' },
    });

    const replayed = simulation.replicateNext('replica-1');
    replayed.audit.actor = 'mutated-replay';
    const replicaRead = simulation.readReplica('replica-1', 'order-123');
    replicaRead.audit.actor = 'mutated-read';

    expect(simulation.readReplica('replica-1', 'order-123')).toEqual({
      ...pendingRecord,
      audit: { actor: 'customer' },
    });
  });
});
