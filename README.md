# Distributed Order System

A compact interview laboratory for learning order processing, concurrency, messaging, failure handling, database consistency, AWS architecture, observability, and disciplined test-driven delivery.

Repository: <https://github.com/machelslackinlondon/distributed-order-system>

## Current status

Phase 0 provides the JavaScript/Jest monorepo tooling and local PostgreSQL/Redis infrastructure. Order behavior begins in Phase 1; the current repository does not yet expose an API or process orders.

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
git clone https://github.com/machelslackinlondon/distributed-order-system.git
cd distributed-order-system
cp .env.example .env
docker compose up -d
npm install
```

## Quality commands

```bash
npm test
npm run lint
npm run format:check
npm run build
```

Phase 0 has no behavioral production code, so Jest is configured to report success when no tests exist. Behavior introduced in later phases must arrive through failing tests first.

## Workspaces

- `apps/api`: HTTP API boundary
- `apps/worker`: asynchronous worker boundary
- `packages/database`: persistence and migrations
- `packages/queue`: local queue and SQS adapters
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

## Known Phase 0 limitations

- No order domain or HTTP endpoint exists yet.
- PostgreSQL and Redis are local development dependencies only.
- Queueing, workers, retries, deduplication, and observability arrive incrementally.
- AWS architecture will be defined but never deployed automatically.
