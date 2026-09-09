# Local observability

The order path carries one correlation identifier across its local boundaries:

```text
x-correlation-id or request ID
        -> POST /orders
        -> order service
        -> ORDER_CREATED message
        -> observed worker handler
```

The API returns the correlation ID in the response header. Structured request and message records
contain `requestId`, `correlationId`, `orderId`, `messageId`, `workerId`, `timestamp`, `duration`,
and `status`; fields that do not apply are `null`. Error records add a compact error name, message,
and stable code when present.

Telemetry sink failures are isolated from application outcomes. The sink may lose a record, but it
does not turn a successful order or message operation into a failure.
Each operation records only its first terminal outcome.

## Metrics

The in-memory registry exposes:

- `orders_created_total`: winning order inserts, excluding idempotent replays
- `orders_completed_total`: non-duplicate observed worker completions
- `orders_failed_total`: observed API or worker failures
- `deduplication_count`: duplicate worker results
- `retry_count` and `concurrency_conflicts`: counters for their owning integrations
- `queue_depth`: a gauge for the queue integration
- `processing_duration`: count, total, average, and maximum milliseconds

Counters, gauges, and duration summaries reset when the process restarts and are not aggregated
across processes. Metric updates reject negative and non-finite values before changing registry
state.

## Current boundary

The `POST /orders` route returns its correlation header even for validation errors. Its custom
operation starts after schema validation and records the outcome only after Fastify sends the
serialized response. Fastify retains its own logging for other requests. The worker wrapper is
exported but is not connected to the local queue, and the remaining metric owners must update their
counters or gauge when they are integrated. Correlation IDs provide a lightweight local trace;
there is no external collector or durable metric store.

## Focused verification

```bash
npm run test:unit -- packages/observability/tests/unit apps/api/tests/unit/order-observability.test.js apps/worker/tests/unit/observed-message-handler.test.js packages/events/tests/unit/order-created.test.js
```
