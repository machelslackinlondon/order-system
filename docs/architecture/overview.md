# Architecture overview

## Phase 1 request flow

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
```

Fastify validates the HTTP body and `Idempotency-Key`. The order service checks that the product exists and that current stock covers the requested quantity. It then writes a `PENDING` order through the database package.

The API reads stock but does not reserve or decrement it. This keeps Phase 1 intentionally simple and leaves a visible race for the later transaction, locking, queue, and worker phases. A `201` response means the request is currently eligible for processing, not that fulfillment is guaranteed.

## Boundaries

- `apps/api` owns HTTP validation, stable error responses, and application decisions.
- `packages/database` owns connection pooling, migrations, parameterized SQL, row mapping, and database availability translation.
- `apps/worker`, `packages/queue`, and `packages/events` are intentionally inactive in Phase 1.

The app factory does not listen on import. Tests inject the order service and use Fastify's in-process request injection, while `server.js` constructs production dependencies and opens the loopback listener.

## Failure behavior

Validation, missing products, insufficient current stock, and database unavailability have stable public codes. Unexpected errors return `INTERNAL_ERROR`. SQL, connection strings, causes, and stack traces are never serialized to clients.
