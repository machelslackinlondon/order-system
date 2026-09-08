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

The winning request publishes one `ORDER_CREATED` message after persistence. Matching sequential or concurrent retries return the committed order without publishing another message.

The HTTP path reads stock but does not reserve or decrement it. Transaction and locking behavior is demonstrated separately, while queued worker processing remains a later step. A `201` response means the request is currently eligible for processing, not that fulfillment is guaranteed.

## Boundaries

- `apps/api` owns HTTP validation, stable error responses, and application decisions.
- `packages/database` owns connection pooling, migrations, parameterized SQL, row mapping, and database availability translation.
- `packages/events` owns stable message construction.
- `packages/queue` owns the local FIFO delivery and acknowledgement contract.
- `apps/worker` remains inactive until worker-pool processing is introduced.

The app factory does not listen on import. Tests inject the order service and use Fastify's in-process request injection, while `server.js` constructs production dependencies and opens the loopback listener.

## Failure behavior

Validation, missing products, insufficient current stock, and database unavailability have stable public codes. Unexpected errors return `INTERNAL_ERROR`. SQL, connection strings, causes, and stack traces are never serialized to clients.
