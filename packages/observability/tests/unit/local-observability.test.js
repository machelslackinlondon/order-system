import { describe, expect, it } from '@jest/globals';

import * as observability from '../../src/index.js';

function localObservability(options) {
  expect(observability.createLocalObservability).toEqual(expect.any(Function));
  return observability.createLocalObservability(options);
}

describe('local observability', () => {
  it('records the complete request context and success metrics', () => {
    const records = [];
    let elapsed = 10;
    const telemetry = localObservability({
      write: (record) => records.push(record),
      wallClock: () => new Date('2026-09-09T14:00:00.000Z'),
      monotonicClock: () => elapsed,
    });
    const context = telemetry.createRequestContext({
      requestId: 'request-123',
      correlationId: 'correlation-123',
    });
    const operation = telemetry.startOperation({ event: 'order.create', context });

    elapsed = 35;
    operation.complete({
      status: 'CREATED',
      context: { orderId: 'order-123' },
      counters: ['orders_created_total'],
    });

    expect(records).toEqual([
      {
        level: 'info',
        event: 'order.create',
        requestId: 'request-123',
        correlationId: 'correlation-123',
        orderId: 'order-123',
        messageId: null,
        workerId: null,
        timestamp: '2026-09-09T14:00:00.000Z',
        duration: 25,
        status: 'CREATED',
      },
    ]);
    expect(telemetry.metrics.snapshot()).toMatchObject({
      orders_created_total: 1,
      orders_failed_total: 0,
      processing_duration: { count: 1, total: 25, average: 25, maximum: 25 },
    });
  });

  it('records errors without changing their identity', () => {
    const records = [];
    let elapsed = 40;
    const telemetry = localObservability({
      write: (record) => records.push(record),
      wallClock: () => new Date('2026-09-09T14:01:00.000Z'),
      monotonicClock: () => elapsed,
    });
    const failure = Object.assign(new Error('database unavailable'), {
      code: 'DATABASE_UNAVAILABLE',
    });
    const operation = telemetry.startOperation({
      event: 'order.create',
      context: telemetry.createRequestContext({ requestId: 'request-456' }),
    });

    elapsed = 52;
    expect(operation.fail(failure, { status: 'FAILED', counters: ['orders_failed_total'] })).toBe(
      failure,
    );

    expect(records).toEqual([
      {
        level: 'error',
        event: 'order.create',
        requestId: 'request-456',
        correlationId: 'request-456',
        orderId: null,
        messageId: null,
        workerId: null,
        timestamp: '2026-09-09T14:01:00.000Z',
        duration: 12,
        status: 'FAILED',
        error: {
          name: 'Error',
          message: 'database unavailable',
          code: 'DATABASE_UNAVAILABLE',
        },
      },
    ]);
  });

  it('builds worker context from propagated message identifiers', () => {
    const telemetry = localObservability({ write: () => undefined });

    expect(
      telemetry.createMessageContext({
        message: {
          requestId: 'request-123',
          correlationId: 'correlation-123',
          orderId: 'order-123',
          messageId: 'order-created:order-123',
        },
        workerId: 'worker-2',
      }),
    ).toEqual({
      requestId: 'request-123',
      correlationId: 'correlation-123',
      orderId: 'order-123',
      messageId: 'order-created:order-123',
      workerId: 'worker-2',
    });
  });

  it('exposes counters, queue depth, and processing duration summaries', () => {
    const telemetry = localObservability({ write: () => undefined });

    telemetry.metrics.increment('retry_count', 2);
    telemetry.metrics.increment('deduplication_count');
    telemetry.metrics.increment('concurrency_conflicts', 3);
    telemetry.metrics.setGauge('queue_depth', 7);
    telemetry.metrics.observe('processing_duration', 10);
    telemetry.metrics.observe('processing_duration', 30);

    expect(telemetry.metrics.snapshot()).toEqual({
      orders_created_total: 0,
      orders_completed_total: 0,
      orders_failed_total: 0,
      queue_depth: 7,
      processing_duration: { count: 2, total: 40, average: 20, maximum: 30 },
      retry_count: 2,
      deduplication_count: 1,
      concurrency_conflicts: 3,
    });
  });

  it('isolates order processing from a failing log sink', () => {
    const telemetry = localObservability({
      write() {
        throw new Error('log sink unavailable');
      },
      monotonicClock: () => 10,
    });
    const operation = telemetry.startOperation({
      event: 'order.create',
      context: telemetry.createRequestContext({ requestId: 'request-789' }),
    });

    expect(() =>
      operation.complete({ status: 'CREATED', counters: ['orders_created_total'] }),
    ).not.toThrow();
    expect(telemetry.metrics.snapshot()).toMatchObject({ orders_created_total: 1 });
  });
});
