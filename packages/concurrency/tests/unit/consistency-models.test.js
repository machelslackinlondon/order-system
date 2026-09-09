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
});
