# Transaction guidance

`createAtomicOrderService` performs one PostgreSQL transaction:

```text
BEGIN
  lock product row
  reserve inventory
  create PENDING order
  create PENDING processing record
COMMIT
```

Any failed step triggers `ROLLBACK`, so inventory, the order, and its processing record cannot be partially persisted. The row lock also serializes competing reservations for the same product.

The ACID guarantees demonstrated are:

- **Atomicity:** all three writes commit or none do.
- **Consistency:** foreign keys, checks, and application validation preserve valid state.
- **Isolation:** PostgreSQL's default `READ COMMITTED` isolation plus `FOR UPDATE` protects the inventory decision from concurrent changes.
- **Durability:** after PostgreSQL confirms `COMMIT`, the transaction survives later application failures; production durability also depends on PostgreSQL and storage configuration.

Run the focused example with:

```bash
npm run db:migrate:test
npm run test:integration -- apps/api/tests/integration/atomic-order.test.js
```

This service remains separate from `POST /orders`; the current HTTP path continues to perform an advisory stock check until asynchronous queue and worker processing are introduced.
