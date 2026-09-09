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

  return {
    increment(name, amount = 1) {
      if (!counters.has(name)) {
        throw new RangeError(`Unknown counter: ${name}`);
      }
      counters.set(name, counters.get(name) + amount);
    },

    setGauge(name, value) {
      if (name !== 'queue_depth') {
        throw new RangeError(`Unknown gauge: ${name}`);
      }
      queueDepth = value;
    },

    observe(name, value) {
      if (name !== 'processing_duration') {
        throw new RangeError(`Unknown duration: ${name}`);
      }
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
      return completeContext({
        requestId: message.requestId,
        correlationId: message.correlationId ?? message.requestId ?? message.messageId,
        orderId: message.orderId,
        messageId: message.messageId,
        workerId,
      });
    },

    startOperation({ event, context }) {
      const startedAt = monotonicClock();

      function finish({ status, context: finalContext = {}, counters = [], error }) {
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
