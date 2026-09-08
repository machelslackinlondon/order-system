# PostgreSQL persistence

## Schema

`products` stores UUID identity, name, non-negative integer stock, and a positive version. `orders` stores UUID order and customer identity, a product foreign key, positive integer quantity and amount, status, version, the caller's idempotency key, and database-generated `timestamptz` timestamps.

`amount` uses minor currency units to avoid floating-point rounding. Phase 1 accepts it from the caller because product pricing is not modeled. The idempotency key is deliberately not unique until the later idempotency phase.

Database checks protect non-negative stock, positive quantities and amounts, allowed statuses, and positive versions even when a caller bypasses the application service.

## Selected access pattern

The system uses a bounded `pg.Pool`, parameterized SQL, and `node-pg-migrate` migrations. Repository factories accept a pool or transaction client, preserving the option to add explicit transactions and row locks without replacing the persistence layer.

An ORM was rejected because later phases need SQL isolation, locking, and retry behavior to remain visible. Handwritten unparameterized queries were rejected because values must never be interpolated into SQL.

## Failure behavior

Connection failures and PostgreSQL shutdown-class errors become `DatabaseUnavailableError` at the database boundary. Constraint violations and programming errors remain distinct and reach the API as unexpected failures unless a later application rule explicitly maps them.

The test database is a separate `orders_test` database in the same local container. Migrations run before integration tests, tests execute serially, and tables are truncated between cases. Automation never silently deletes an existing developer volume.

## Scaling and consistency limits

The Phase 1 stock read and order insert are separate operations. Concurrent requests can all observe the same stock, and accepted orders can exceed fulfillable inventory. Later phases introduce transaction boundaries, locking or optimistic checks, queue publication, and worker-owned reservation.

The single PostgreSQL instance and local process are sufficient for this learning slice. Before horizontal scale, the system also needs enforced idempotency, safe publication, retry policy, observability, and explicit reconciliation.
