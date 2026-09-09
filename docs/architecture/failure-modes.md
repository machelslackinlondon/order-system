# Failure-mode guidance

This guide records current behavior and the recovery boundary for each failure. PostgreSQL-backed
operations, the Redis lock experiment, and local queue behavior are tested independently. The queue
and worker are not yet wired together, payments are not implemented, and the process-local queue is
not durable.

## Database is unavailable

- **Failure:** A PostgreSQL query, transaction, or connection cannot complete.
- **Impact:** `POST /orders` returns `503 DATABASE_UNAVAILABLE`; database-backed message processing
  also rejects.
- **Detection:** Alert on the stable error code, failed health checks, connection-pool saturation,
  and database latency.
- **Recovery:** Restore connectivity, then retry the same order with the same `Idempotency-Key`.
  Leave failed messages unacknowledged for later delivery.
- **Data consistency:** Failed transactions roll back. If connectivity is lost around commit, the
  result may be unknown; the unique idempotency key resolves a safe retry.

## Redis is unavailable

- **Failure:** A lock acquire or release cannot reach Redis.
- **Impact:** Lock operations reject with `REDIS_LOCK_UNAVAILABLE`; the current order API is
  unaffected because Redis locks are not in its request path.
- **Detection:** Monitor Redis health and the error's `ACQUIRE` or `RELEASE` operation field.
- **Recovery:** Stop lock-protected work and retry only after Redis recovers. An uncertain release
  must not be treated as proof that the caller still owns the lease.
- **Data consistency:** Continuing without a confirmed lease can create concurrent owners. A real
  workflow also needs fencing tokens so stale owners cannot write after recovery.

## Queue is unavailable

- **Failure:** The local queue has shut down or rejects publication because its configured capacity
  is full.
- **Impact:** Publication rejects; a waiting overflow policy can instead delay the producer. In the
  API flow, the order may already be stored.
- **Detection:** Monitor `QUEUE_SHUTDOWN`, `QUEUE_CAPACITY_EXCEEDED`, queue depth, waiting publishers,
  and API `500 INTERNAL_ERROR` responses caused by publisher failures.
- **Recovery:** Restore queue capacity and reconcile stored orders with published events. Retrying
  the same API request currently returns the stored order without republishing.
- **Data consistency:** PostgreSQL and queue state can diverge. A transactional outbox is required
  for reliable eventual publication.

## Worker crashes

- **Failure:** A handler rejects or its process exits while work is in flight.
- **Impact:** A rejected local handler leaves the message at the queue head for the next consumer.
  A full process exit loses the process-local queue and all pending messages.
- **Detection:** Use process health checks, failed-job metrics, missing heartbeats, and stale pending
  work alerts.
- **Recovery:** Restart the worker. Production delivery needs a durable broker that redelivers
  unacknowledged messages; the local adapter cannot recover messages after process exit.
- **Data consistency:** An open PostgreSQL transaction rolls back on connection loss, but external
  effects may be partial and require idempotency plus reconciliation.

## API crashes

- **Failure:** The API process exits before responding, possibly around database commit or event
  publication.
- **Impact:** The client sees a disconnect and cannot know whether the order was accepted. Any local
  queued messages in that process are lost.
- **Detection:** Monitor process restarts, failed readiness checks, incomplete request traces, and
  client disconnects.
- **Recovery:** Restart the API and retry the identical payload with the same `Idempotency-Key`.
- **Data consistency:** Idempotency recovers an order that committed before the crash, but it cannot
  repair an event that was not published.

## Network request times out

- **Failure:** A caller stops waiting before the API or a downstream dependency returns.
- **Impact:** The outcome is unknown; the operation may have completed after the timeout.
- **Detection:** Correlate client timeout metrics with server request IDs, traces, and order lookup.
- **Recovery:** Retry the same operation with the same idempotency key and bounded backoff, or query
  its status when available.
- **Data consistency:** Creating a new key for each retry can create duplicate orders. Reusing the
  original key returns the committed result or safely performs the missing operation.

## Payment provider times out

- **Failure:** A future payment request receives no definitive provider response.
- **Impact:** Payment outcome is unknown and the order must remain pending rather than assuming
  success or failure. Payments are not currently integrated.
- **Detection:** Record provider request IDs, timeout metrics, webhooks, and reconciliation results.
- **Recovery:** Retry with the same provider idempotency key and reconcile against provider status
  before changing the order state.
- **Data consistency:** Blind retries can duplicate charges; assuming failure can conflict with a
  late success. State transitions must consume one authoritative outcome idempotently.

## Duplicate message arrives

- **Failure:** At-least-once delivery supplies the same stable `messageId` again.
- **Impact:** Without deduplication, the handler could repeat inventory, payment, or order effects.
- **Detection:** The `processed_messages` unique claim returns `DUPLICATE`, and delivery metrics can
  count repeated IDs.
- **Recovery:** Skip the handler and acknowledge the duplicate. Retain deduplication records for at
  least the broker's possible redelivery window.
- **Data consistency:** PostgreSQL effects made with the supplied transaction client commit atomically
  with the claim. External effects still need their own idempotency keys.

## Processing succeeds but acknowledgement fails

- **Failure:** The handler commits its effects, but the transport does not retain the acknowledgement.
- **Impact:** The message is delivered again even though the first attempt completed.
- **Detection:** Observe a repeated `messageId`, elevated delivery attempts, and a `DUPLICATE`
  processor result.
- **Recovery:** Run the duplicate through the idempotent processor, skip its handler, then acknowledge
  it again.
- **Data consistency:** Transactional PostgreSQL effects remain single-application. Non-transactional
  external effects are safe only when they use stable idempotency keys.

## Database succeeds but event publication fails

- **Failure:** A new `PENDING` order commits, then `ORDER_CREATED` publication rejects.
- **Impact:** The API returns `500 INTERNAL_ERROR`, the order remains stored, and no worker receives
  its event.
- **Detection:** Alert on publisher errors and reconcile new orders against outbox or processing
  records. The focused service test proves insertion precedes the visible publication error.
- **Recovery:** Until a transactional outbox exists, reconcile and republish manually. A normal retry
  of the same request returns the existing order and does not republish.
- **Data consistency:** Order and messaging state diverge. Persisting an outbox record in the order
  transaction, then publishing it asynchronously, closes this gap.

Related details are in the [queue](queue.md), [retry](retries.md),
[deduplication](deduplication.md), and [idempotency](idempotency.md) guidance.
