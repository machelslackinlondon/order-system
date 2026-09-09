# Architecture overview

## Request flow

```text
POST /orders
    |
    v
Fastify validation
    |
    v
Order service ----> Product repository ----> PostgreSQL products
    |
    +-------------> Order repository ------> PostgreSQL orders
    |
    +-------------> Event publisher -------> Local FIFO queue
```

Fastify validates the HTTP body and `Idempotency-Key`. The order service first resolves a matching retry, then checks that the product exists and current stock covers a new request. The database uniqueness constraint selects one winner when identical requests arrive concurrently.

On the normal path, the winning request publishes one `ORDER_CREATED` message after persistence. Matching sequential or concurrent retries return the committed order without publishing another message. Database persistence and local publication are not atomic; the queue guidance records this failure window.

The HTTP path reads stock but does not reserve or decrement it. Transaction and locking behavior is demonstrated separately, while queue-to-worker processing remains a later step. A `201` response means the request is currently eligible for processing, not that fulfillment is guaranteed.

## Boundaries

- `apps/api` owns HTTP validation, stable error responses, and application decisions.
- `packages/database` owns connection pooling, migrations, parameterized SQL, row mapping, and database availability translation.
- `packages/events` owns stable message construction.
- `packages/queue` owns the local FIFO delivery and acknowledgement contract, backpressure, and
  educational delivery-semantics simulations.
- `packages/retries` owns failure classification, retry delays, and dead-letter records.
- `packages/locks` owns token-based Redis lease acquisition and safe release.
- `packages/access-control` owns executable local workload capability policies; these are guidance
  and are not enforced by the runtime.
- `packages/concurrency` owns isolated race, locking, network-partition, consistency, replication,
  sharding, and leader-election simulations; these are not wired into the request path.
- `apps/worker` owns bounded concurrent execution, worker metrics, and isolated message-claim and
  event-consumer examples; it is not yet connected to the queue.

The app factory does not listen on import. Tests inject the order service and use Fastify's in-process request injection, while `server.js` constructs production dependencies and opens the loopback listener.

## Failure behavior

Validation, missing products, insufficient current stock, and database unavailability have stable public codes. Unexpected errors return `INTERNAL_ERROR`. SQL, connection strings, causes, and stack traces are never serialized to clients.

See the [failure-mode guidance](failure-modes.md) for dependency outages, ambiguous outcomes,
redelivery, crash recovery, and the current database-to-queue publication gap.
