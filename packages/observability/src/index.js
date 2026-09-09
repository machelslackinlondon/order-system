import { performance } from 'node:perf_hooks';

const counterNames = [
  'orders_created_total',
  'orders_completed_total',
  'orders_failed_total',
  'retry_count',
  'deduplication_count',
  'concurrency_conflicts',
];

function createMetricsRegistry() {
  const counters = new Map(counterNames.map((name) => [name, 0]));
  let queueDepth = 0;
  let durationCount = 0;
  let durationTotal = 0;
  let durationMaximum = 0;

  function assertMetricValue(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RangeError('Metric values must be finite, nonnegative numbers');
    }
  }

  return {
    increment(name, amount = 1) {
      if (!counters.has(name)) {
        throw new RangeError(`Unknown counter: ${name}`);
      }
      assertMetricValue(amount);
      counters.set(name, counters.get(name) + amount);
    },

    setGauge(name, value) {
      if (name !== 'queue_depth') {
        throw new RangeError(`Unknown gauge: ${name}`);
      }
      assertMetricValue(value);
      queueDepth = value;
    },

    observe(name, value) {
      if (name !== 'processing_duration') {
        throw new RangeError(`Unknown duration: ${name}`);
      }
      assertMetricValue(value);
      durationCount += 1;
      durationTotal += value;
      durationMaximum = Math.max(durationMaximum, value);
    },

    snapshot() {
      return {
        orders_created_total: counters.get('orders_created_total'),
        orders_completed_total: counters.get('orders_completed_total'),
        orders_failed_total: counters.get('orders_failed_total'),
        queue_depth: queueDepth,
        processing_duration: {
          count: durationCount,
          total: durationTotal,
          average: durationCount === 0 ? 0 : durationTotal / durationCount,
          maximum: durationMaximum,
        },
        retry_count: counters.get('retry_count'),
        deduplication_count: counters.get('deduplication_count'),
        concurrency_conflicts: counters.get('concurrency_conflicts'),
      };
    },
  };
}

function completeContext(context = {}) {
  return {
    requestId: context.requestId ?? null,
    correlationId: context.correlationId ?? null,
    orderId: context.orderId ?? null,
    messageId: context.messageId ?? null,
    workerId: context.workerId ?? null,
  };
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return { name: 'NonErrorThrown', message: String(error) };
  }

  return {
    name: error.name,
    message: error.message,
    ...(error.code ? { code: error.code } : {}),
  };
}

function safelyWrite(write, record) {
  try {
    const writing = write(record);
    if (writing && typeof writing.catch === 'function') {
      void writing.catch(() => undefined);
    }
  } catch {
    // Telemetry failures must not change application outcomes.
  }
}

export function createLocalObservability({
  write,
  wallClock = () => new Date(),
  monotonicClock = () => performance.now(),
}) {
  const metrics = createMetricsRegistry();

  return {
    metrics,

    createRequestContext({ requestId, correlationId }) {
      return completeContext({
        requestId,
        correlationId:
          typeof correlationId === 'string' && correlationId.trim() !== ''
            ? correlationId
            : requestId,
      });
    },

    createMessageContext({ message, workerId }) {
      const source = message && typeof message === 'object' ? message : {};
      const correlationId = [source.correlationId, source.requestId, source.messageId].find(
        (identifier) => typeof identifier === 'string' && identifier.trim() !== '',
      );

      return completeContext({
        requestId: source.requestId,
        correlationId,
        orderId: source.orderId,
        messageId: source.messageId,
        workerId,
      });
    },

    startOperation({ event, context }) {
      const startedAt = monotonicClock();
      let finished = false;
      let terminalRecord;

      function finish({ status, context: finalContext = {}, counters = [], error }) {
        if (finished) {
          return terminalRecord;
        }

        const duration = Math.max(0, monotonicClock() - startedAt);
        for (const counter of counters) {
          metrics.increment(counter);
        }
        metrics.observe('processing_duration', duration);

        const record = {
          level: error === undefined ? 'info' : 'error',
          event,
          ...completeContext({ ...context, ...finalContext }),
          timestamp: wallClock().toISOString(),
          duration,
          status,
          ...(error === undefined ? {} : { error: serializeError(error) }),
        };
        finished = true;
        terminalRecord = record;
        safelyWrite(write, record);
        return record;
      }

      return {
        complete(options) {
          return finish(options);
        },

        fail(error, options) {
          finish({ ...options, error });
          return error;
        },
      };
    },
  };
}
