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

The order route derives a correlation ID from the request header or request ID and carries it
through the service into the published message. The API records the request outcome, and an exported
worker wrapper can record message outcomes with the same correlation ID.

The HTTP path reads stock but does not reserve or decrement it. Transaction and locking behavior is demonstrated separately. A focused local queue processor demonstrates retry and dead-letter acknowledgement boundaries, but the application runtime does not start it or connect the queue to the worker pool. A `201` response means the request is currently eligible for processing, not that fulfillment is guaranteed.

## Guidance map

Use the existing focused documents as the source of truth for each design area. The source and test
paths make the guidance executable; the [commit map](../development/commit-map.md) links each topic
to its red and green history.

| Area                              | Guidance                                                                                                                                                                                                 | Executable proof                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Request and persistence           | [Database](database.md), [transactions](transactions.md), [idempotency](idempotency.md), and [failure modes](failure-modes.md)                                                                           | `apps/api/src/`, `packages/database/src/`, and their focused tests                                       |
| Concurrency and data distribution | [CAP](cap.md), [consistency models](consistency-models.md), [replication](replication.md), [sharding](sharding.md), [leader election](leader-election.md), and [distributed locks](distributed-locks.md) | `packages/concurrency/`, `packages/locks/`, and the [experiment commands](../development/experiments.md) |
| Messaging and overload            | [Queue delivery](queue.md), [messaging semantics](messaging-semantics.md), [retries](retries.md), [deduplication](deduplication.md), and [backpressure](backpressure.md)                                 | `packages/queue/`, `packages/retries/`, and their focused tests                                          |
| Worker processing                 | [Worker pools](workers.md), [local event consumption](local-event-consumer.md), and [Redis idempotency](redis-idempotency.md)                                                                            | `apps/worker/src/` and `apps/worker/tests/`                                                              |
| Local operation                   | [Observability](observability.md), [local access control](local-access-control.md), and [failure modes](failure-modes.md)                                                                                | `packages/observability/`, `packages/access-control/`, and the local health route                        |

## Boundaries

- `apps/api` owns HTTP validation, stable error responses, and application decisions.
- `packages/database` owns connection pooling, migrations, parameterized SQL, row mapping, and database availability translation.
- `packages/events` owns stable message construction.
- `packages/queue` owns the local FIFO delivery and acknowledgement contract, backpressure, and
  educational delivery-semantics simulations.
- `packages/retries` owns failure classification, retry delays, and dead-letter records.
- `packages/locks` owns token-based Redis lease acquisition and safe release.
- `packages/observability` owns structured local records, correlation context, and in-memory
  metrics.
- `packages/access-control` owns executable local workload capability policies; these are guidance
  and are not enforced by the runtime.
- `packages/concurrency` owns isolated race, locking, network-partition, consistency, replication,
  sharding, and leader-election simulations; these are not wired into the request path.
- `packages/experiments` owns deterministic local commands that expose selected behaviors and point
  back to their source, tests, and commits.
- `apps/worker` owns bounded concurrent execution, worker metrics, and isolated message-claim and
  event-consumer examples; it is not yet connected to the queue.

The app factory does not listen on import. Tests inject the order service and use Fastify's in-process request injection, while `server.js` constructs production dependencies and opens the loopback listener.

## Failure behavior

Validation, missing products, insufficient current stock, and database unavailability have stable public codes. Unexpected errors return `INTERNAL_ERROR`. SQL, connection strings, causes, and stack traces are never serialized to clients.

See the [failure-mode guidance](failure-modes.md) for dependency outages, ambiguous outcomes,
redelivery, crash recovery, and the current database-to-queue publication gap.
