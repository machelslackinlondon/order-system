# Idempotency guidance

`POST /orders` hashes the canonical order payload and stores that fingerprint beside a unique `Idempotency-Key`.

```text
same key + same fingerprint      -> return the original order
same key + different fingerprint -> 409 IDEMPOTENCY_KEY_REUSED
new key                          -> validate stock and attempt INSERT
```

The initial lookup makes normal retries cheap, but it is not the correctness boundary: simultaneous requests can both miss it. `INSERT ... ON CONFLICT` and the PostgreSQL unique constraint select one committed order, after which losing requests load and return that order.

This covers retries after a timeout or lost response because the committed result is addressable by the same key. Clients should generate a new key for a genuinely new order and retain a key while retrying the same payload.

New HTTP and atomic orders store the same fingerprint. UUIDs are normalized to lowercase before hashing so equivalent UUID representations match PostgreSQL's stored form. For an older row whose fingerprint is `NULL`, the service reconstructs it from the persisted order fields, preserving identical retries while still rejecting a changed payload. Atomic processing rechecks the key after acquiring the product lock and rolls back any later duplicate work, so a retry returns the winner even when its reservation consumed the remaining stock.

Before applying the uniqueness migration to an existing database, reconcile any duplicate `idempotency_key` values; the migration intentionally fails instead of silently deleting orders.

Run the focused behavior with:

```bash
npm run test:integration -- apps/api/tests/integration/orders-route.test.js
```
