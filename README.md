# Distributed Order System

A compact reference implementation and practical guide to order processing, concurrency, messaging, failure handling, database consistency, local deployment, observability, and disciplined test-driven delivery.

Repository: <https://github.com/machelslackinlondon/order-system>

## Current status

`POST /orders` validates the request and current PostgreSQL stock, persists a retry-safe `PENDING` order, and publishes one local `ORDER_CREATED` message for the winning insert. Reusing an `Idempotency-Key` with the same payload returns the original order without republishing; using it with a different payload returns `409`. The local queue supports backpressure, workers provide bounded concurrency, retries provide exponential backoff and dead-lettering, and PostgreSQL-backed deduplication prevents duplicate processing. A focused local processor composes queue delivery, retries, and dead-letter acknowledgement, but the application runtime does not start it. Token-owned Redis leases and deterministic simulations demonstrate distributed-system trade-offs without changing the production request path.

An optional [Redis claim-store example](docs/architecture/redis-idempotency.md) demonstrates
conditional duplicate suppression with TTL retention. A small
[local analytics consumer](docs/architecture/local-event-consumer.md) demonstrates event
validation, duplicate suppression, and retry cleanup. An executable
[local access-control example](docs/architecture/local-access-control.md) defines exact workload
capabilities and rejects wildcard or administrative grants. These remain isolated examples;
PostgreSQL remains the default transactional deduplication mechanism.

[Local observability](docs/architecture/observability.md) emits structured order-request records,
propagates correlation IDs into `ORDER_CREATED` messages, wraps worker handling, and exposes
process-local metrics without external telemetry dependencies.

See the [failure-mode guidance](docs/architecture/failure-modes.md) for current outage behavior and
the [messaging-semantics guidance](docs/architecture/messaging-semantics.md) for the distinction
between delivery guarantees and application-level effects. The
[architecture overview](docs/architecture/overview.md) maps every design area to its focused
guidance and executable proof.

## Architecture direction

```text
Customer -> Caddy gateway -> Order API -> PostgreSQL
                                  |
                                  +-> local FIFO queue (same process, no active consumer)

Focused retry composition: local queue -> retry policy -> handler or dead-letter queue
Deterministic experiments: concurrency, messaging, workers, and Redis locks
```

The optional Compose application profile runs the gateway, migrations, API, PostgreSQL, and Redis
using only local dependencies.

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
docker compose up -d postgres redis
npm run db:migrate
docker compose exec -T postgres psql -U orders -d orders -c \
  "INSERT INTO products (id, name, stock, version) VALUES ('0f2a6064-9daa-4947-a739-b8825e2b8146', 'Mechanical Keyboard', 5, 1) ON CONFLICT (id) DO NOTHING"
npm run start:api
```

Alternatively, run the application profile entirely in containers:

```bash
docker compose --profile app up --build -d
curl --fail http://127.0.0.1:8080/health
```

See the [local infrastructure guidance](infra/docker/README.md) for lifecycle and boundary details.

In a second terminal, create an order through the container gateway. Use port `3000` instead when
running the API natively:

```bash
curl --fail-with-body \
  --request POST http://127.0.0.1:8080/orders \
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

`npm test` runs unit tests followed by serial integration tests against the `orders_test`
PostgreSQL database and the dedicated nonzero Redis database selected by `TEST_REDIS_URL`. Start
both services first with `docker compose up -d postgres redis`.

## Run experiments

The experiment commands run deterministic local scenarios without starting PostgreSQL, Redis, or
the application runtime:

```bash
npm run experiment:race-condition
npm run experiment:optimistic-lock
npm run experiment:pessimistic-lock
npm run experiment:idempotency
npm run experiment:retries
npm run experiment:deduplication
npm run experiment:worker-pool
npm run experiment:backpressure
npm run experiment:distributed-lock
```

Each command prints the behavior, observations, result, source, and relevant commits. See the
[experiment command guidance](docs/development/experiments.md) for boundaries and focused
verification.

## Workspaces

- `apps/api`: HTTP API boundary
- `apps/worker`: configurable asynchronous worker pool
- `packages/database`: persistence and migrations
- `packages/queue`: local FIFO queue, delivery contract, and backpressure
- `packages/retries`: transient failure backoff and local dead-letter delivery
- `packages/locks`: token-owned Redis leases with TTL and safe release
- `packages/access-control`: local least-privilege workload policies
- `packages/events`: event contracts and publishing
- `packages/concurrency`: explicit concurrency experiments
- `packages/observability`: logs, metrics, and tracing
- `packages/experiments`: deterministic local command runner

## TDD and Git history

Behavioral topics use separate red and green commits:

1. `test(<topic>): ...` records a meaningful failing test.
2. `feat(<topic>): ...` adds the minimum code that makes it pass.
3. Refactoring and documentation remain focused and keep the suite green.

Inspect the history with:

```bash
git log --oneline --decorate --graph
```

Read each focused pair in listed order: the first commit defines the failing behavior and the second
implements it. Remove `--stat` when the complete patches are useful.

```bash
git show --stat 3c03007 be69c50  # lost update
git show --stat 470ba83 110544d  # optimistic retry
git show --stat 5317d01 7129162  # atomic transaction
git show --stat 9845f99 0d8be61  # order idempotency
git show --stat 1afc8ff 3f01e8e  # local queue
git show --stat c861e1c fc4c983  # retries and dead-lettering
git show --stat 1505a96 d31063d  # message deduplication
git show --stat dd3cff3 642cadd  # distributed lock
```

See the [Git workflow](docs/development/git-workflow.md) for the commit discipline, the
[commit map](docs/development/commit-map.md) for concept-to-commit navigation, the
[architecture map](docs/architecture/overview.md) for focused design documents, and the
[engineering guidance](docs/guidance/engineering.md) for decision prompts and executable evidence.

## Known limitations

- The stock check is advisory and inventory is not decremented.
- The caller supplies `amount` because product pricing is not modeled yet.
- The queue is process-local and volatile; its retrying processor is covered independently but is not started by the application runtime.
- Order persistence and local publication are not atomic, and the API has no active queue consumer.
- Atomic inventory reservation, worker processing, retries, deduplication, and locks remain explicit examples rather than one runtime workflow.
- Payment processing is not modeled.
- The deployment profile is fully local and provides no durable cross-process message broker.
- Observability metrics are process-local and reset on restart.
