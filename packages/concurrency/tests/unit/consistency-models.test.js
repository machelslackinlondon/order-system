import { describe, expect, it } from '@jest/globals';

import * as concurrency from '../../src/index.js';

const pendingOrder = {
  id: 'order-123',
  customerId: 'customer-123',
  status: 'PENDING',
  amount: 12_500,
};

const pendingRecord = { ...pendingOrder, version: 1 };
const confirmedRecord = { ...pendingOrder, status: 'CONFIRMED', version: 2 };

function orderWithAudit() {
  return { ...pendingOrder, audit: { actor: 'customer' } };
}

function createSimulation() {
  expect(concurrency.createOrderConsistencySimulation).toEqual(expect.any(Function));
  return concurrency.createOrderConsistencySimulation();
}

describe('order consistency model simulation', () => {
  it('reads a committed order from the source of truth immediately', () => {
    const simulation = createSimulation();

    const write = simulation.writeOrder(pendingOrder);

    expect(write).toEqual({
      order: pendingRecord,
      token: { orderId: 'order-123', minimumVersion: 1 },
    });
    expect(simulation.readSource('order-123')).toEqual(pendingRecord);
  });

  it('keeps the read model stale while its update remains queued', () => {
    const simulation = createSimulation();

    simulation.writeOrder(pendingOrder);

    expect(simulation.readModel('order-123')).toBeNull();
  });

  it("returns a session's latest write while the shared read model is stale", () => {
    const simulation = createSimulation();
    simulation.writeOrder(pendingOrder);
    simulation.applyNextReadModelUpdate();
    const latestWrite = simulation.writeOrder({ ...pendingOrder, status: 'CONFIRMED' });

    expect(simulation.readModel('order-123')).toEqual(pendingRecord);
    expect(simulation.readForSession(latestWrite.token)).toEqual(confirmedRecord);
  });

  it('converges after every queued read-model update is applied', () => {
    const simulation = createSimulation();
    simulation.writeOrder(pendingOrder);
    simulation.writeOrder({ ...pendingOrder, status: 'CONFIRMED' });

    expect(simulation.applyNextReadModelUpdate()).toEqual(pendingRecord);
    expect(simulation.readModel('order-123')).toEqual(pendingRecord);
    expect(simulation.applyNextReadModelUpdate()).toEqual(confirmedRecord);
    expect(simulation.readModel('order-123')).toEqual(confirmedRecord);
    expect(simulation.applyNextReadModelUpdate()).toBeNull();
  });

  it('isolates the source of truth from nested input mutations', () => {
    const simulation = createSimulation();
    const order = orderWithAudit();

    simulation.writeOrder(order);
    order.audit.actor = 'mutated-input';

    expect(simulation.readSource('order-123')).toEqual({
      ...pendingRecord,
      audit: { actor: 'customer' },
    });
  });

  it('isolates the source of truth from nested write-result mutations', () => {
    const simulation = createSimulation();

    const write = simulation.writeOrder(orderWithAudit());
    write.order.audit.actor = 'mutated-result';

    expect(simulation.readSource('order-123')).toEqual({
      ...pendingRecord,
      audit: { actor: 'customer' },
    });
  });

  it('isolates the read model from nested projection-result mutations', () => {
    const simulation = createSimulation();
    simulation.writeOrder(orderWithAudit());

    const applied = simulation.applyNextReadModelUpdate();
    applied.audit.actor = 'mutated-result';
    const firstRead = simulation.readModel('order-123');
    firstRead.audit.actor = 'mutated-read';

    expect(simulation.readModel('order-123')).toEqual({
      ...pendingRecord,
      audit: { actor: 'customer' },
    });
  });

  it.each([
    { label: 'a null value', order: null },
    { label: 'a missing ID', order: { status: 'PENDING' } },
    { label: 'an empty ID', order: { id: '', status: 'PENDING' } },
    { label: 'a non-string ID', order: { id: 123, status: 'PENDING' } },
  ])('rejects an invalid order with $label', ({ order }) => {
    const simulation = createSimulation();

    expect(() => simulation.writeOrder(order)).toThrow('Order must have a non-empty string ID');
  });

  it.each([
    { label: 'null', token: null },
    { label: 'missing fields', token: {} },
    { label: 'empty order ID', token: { orderId: '', minimumVersion: 1 } },
    { label: 'negative version', token: { orderId: 'order-123', minimumVersion: -1 } },
    { label: 'fractional version', token: { orderId: 'order-123', minimumVersion: 1.5 } },
  ])('rejects a session token with $label', ({ token }) => {
    const simulation = createSimulation();

    expect(() => simulation.readForSession(token)).toThrow(
      'Session token must contain an order ID and non-negative integer minimum version',
    );
  });
});
