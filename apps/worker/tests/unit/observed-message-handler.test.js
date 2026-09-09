import { describe, expect, it } from '@jest/globals';
import * as localTelemetry from '@order-system/observability';

import * as worker from '../../src/index.js';

function localObservability(options) {
  expect(localTelemetry.createLocalObservability).toEqual(expect.any(Function));
  return localTelemetry.createLocalObservability(options);
}

const message = {
  requestId: 'request-123',
  correlationId: 'correlation-123',
  orderId: 'order-123',
  messageId: 'order-created:order-123',
  type: 'ORDER_CREATED',
};

function observedHandler(options) {
  expect(worker.createObservedMessageHandler).toEqual(expect.any(Function));
  return worker.createObservedMessageHandler(options);
}

describe('observed message handler', () => {
  it('preserves worker context and records successful processing', async () => {
    const records = [];
    let elapsed = 10;
    const observability = localObservability({
      write: (record) => records.push(record),
      wallClock: () => new Date('2026-09-09T14:03:00.000Z'),
      monotonicClock: () => elapsed,
    });
    const handle = observedHandler({
      observability,
      workerId: 'worker-1',
      async handler(received) {
        elapsed = 28;
        return `${received.orderId}:processed`;
      },
    });

    await expect(handle(message)).resolves.toBe('order-123:processed');
    expect(records).toEqual([
      {
        level: 'info',
        event: 'message.process',
        requestId: 'request-123',
        correlationId: 'correlation-123',
        orderId: 'order-123',
        messageId: 'order-created:order-123',
        workerId: 'worker-1',
        timestamp: '2026-09-09T14:03:00.000Z',
        duration: 18,
        status: 'COMPLETED',
      },
    ]);
    expect(observability.metrics.snapshot()).toMatchObject({ orders_completed_total: 1 });
  });

  it('records failed processing and preserves the original error', async () => {
    const records = [];
    const processingError = Object.assign(new Error('payment failed'), {
      code: 'PAYMENT_FAILED',
    });
    const observability = localObservability({
      write: (record) => records.push(record),
      monotonicClock: () => 10,
    });
    const handle = observedHandler({
      observability,
      workerId: 'worker-2',
      async handler() {
        throw processingError;
      },
    });

    await expect(handle(message)).rejects.toBe(processingError);
    expect(records).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'message.process',
        messageId: 'order-created:order-123',
        workerId: 'worker-2',
        status: 'FAILED',
        error: {
          name: 'Error',
          message: 'payment failed',
          code: 'PAYMENT_FAILED',
        },
      }),
    ]);
    expect(observability.metrics.snapshot()).toMatchObject({ orders_failed_total: 1 });
  });
});
