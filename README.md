# Distributed Order System

A compact reference implementation and practical guide to order processing, concurrency, messaging, failure handling, database consistency, AWS architecture, observability, and disciplined test-driven delivery.

Repository: <https://github.com/machelslackinlondon/order-system>

## Current status

`POST /orders` validates the request and current PostgreSQL stock, persists a retry-safe `PENDING` order, and publishes one local `ORDER_CREATED` message for the winning insert. Reusing an `Idempotency-Key` with the same payload returns the original order without republishing; using it with a different payload returns `409`. The local queue supports bounded capacity, producer rejection or waiting, and depth metrics. A configurable worker pool provides bounded concurrent processing, and a local retry policy provides exponential backoff, error classification, and dead-lettering. Queue-to-pool wiring remains separate.

## Architecture direction

```text
Customer -> Order API -> PostgreSQL -> Queue -> Workers
                    |                    |         |
                    +-> Redis            |         +-> Inventory
                                         +------------> Payment simulation
```

The repository deliberately uses a small number of well-defined modules rather than many microservices. Local adapters will remain usable without AWS; later infrastructure maps the same responsibilities to managed AWS services.

## Prerequisites

- Node.js 24
- npm
- Docker Engine with Docker Compose v2

## Run locally

```bash
git clone https://github.com/machelslackinlondon/order-system.git
cd order-system
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate
docker compose exec -T postgres psql -U orders -d orders -c \
  "INSERT INTO products (id, name, stock, version) VALUES ('0f2a6064-9daa-4947-a739-b8825e2b8146', 'Mechanical Keyboard', 5, 1) ON CONFLICT (id) DO NOTHING"
npm run start:api
```

In a second terminal, create an order:

```bash
curl --fail-with-body \
  --request POST http://127.0.0.1:3000/orders \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: order-request-123' \
  --data '{
    "customerId": "0fd846a4-728b-4b67-919c-53ecfef632ae",
    "productId": "0f2a6064-9daa-4947-a739-b8825e2b8146",
    "quantity": 2,
    "amount": 2598
  }'
```

`amount` is supplied in minor currency units. A successful `201` response means the order was accepted as `PENDING`; it does not reserve stock or guarantee fulfillment.

## Quality commands

```bash
npm test
npm run lint
npm run format:check
npm run build
```

`npm test` runs unit tests followed by serial integration tests against the `orders_test` PostgreSQL database. Start PostgreSQL first with `docker compose up -d postgres`.

## Workspaces

- `apps/api`: HTTP API boundary
- `apps/worker`: configurable asynchronous worker pool
- `packages/database`: persistence and migrations
- `packages/queue`: local FIFO queue, delivery contract, and backpressure
- `packages/retries`: transient failure backoff and local dead-letter delivery
- `packages/events`: event contracts and publishing
- `packages/concurrency`: explicit concurrency experiments
- `packages/observability`: logs, metrics, and tracing

## TDD and Git history

Behavioral topics use separate red and green commits:

1. `test(<topic>): ...` records a meaningful failing test.
2. `feat(<topic>): ...` adds the minimum code that makes it pass.
3. Refactoring and documentation remain focused and keep the suite green.

Inspect the history with:

```bash
git log --oneline --decorate --graph
```

See [`docs/development/git-workflow.md`](docs/development/git-workflow.md) for the workflow and [`docs/development/commit-map.md`](docs/development/commit-map.md) for concept-to-commit navigation.

## Known limitations

- The stock check is advisory and inventory is not decremented.
- The caller supplies `amount` because product pricing is not modeled yet.
- The queue is process-local and volatile; durable delivery arrives in a later phase.
- Order persistence and local publication are not atomic, and the API has no active queue consumer yet.
- Queue-to-worker delivery, retry integration, payments, and Redis behavior arrive in later phases.
- PostgreSQL and Redis are local development dependencies; AWS resources are never deployed automatically.
