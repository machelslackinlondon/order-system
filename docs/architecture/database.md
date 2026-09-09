# PostgreSQL persistence

## Schema

`products` stores UUID identity, name, non-negative integer stock, and a positive version. `orders` stores UUID order and customer identity, a product foreign key, positive integer quantity and amount, status, version, a unique idempotency key, an HTTP request fingerprint, and database-generated `timestamptz` timestamps. `processed_messages` stores a unique message identifier and processing timestamp for consumer deduplication.

`amount` uses minor currency units to avoid floating-point rounding. The API accepts it from the caller because product pricing is not modeled.

Database checks protect non-negative stock, positive quantities and amounts, allowed statuses, and positive versions even when a caller bypasses the application service.

## Selected access pattern

The system uses a bounded `pg.Pool`, parameterized SQL, and `node-pg-migrate` migrations. Repository factories accept a pool or transaction client, preserving the option to add explicit transactions and row locks without replacing the persistence layer.

An ORM was rejected because later phases need SQL isolation, locking, and retry behavior to remain visible. Handwritten unparameterized queries were rejected because values must never be interpolated into SQL.

## Failure behavior

Connection failures and PostgreSQL shutdown-class errors become `DatabaseUnavailableError` at the database boundary. Constraint violations and programming errors remain distinct and reach the API as unexpected failures unless a later application rule explicitly maps them.

The test database is a separate `orders_test` database in the same local container. Migrations run before integration tests, tests execute serially, and tables are truncated between cases. Automation never silently deletes an existing developer volume.

## Scaling and consistency limits

The production stock read and order insert remain separate operations. Concurrent requests for different idempotency keys can all observe the same stock, and accepted orders can exceed fulfillable inventory. The transaction and locking experiments demonstrate safe reservation strategies; the later worker phase will select and apply one to the processing flow.

The single PostgreSQL instance and local process are sufficient for this slice. Before horizontal scale, the system also needs safe publication, retry policy, observability, and explicit reconciliation.
