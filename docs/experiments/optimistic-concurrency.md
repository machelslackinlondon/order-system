# Optimistic inventory concurrency guidance

Run the focused examples with:

```bash
docker compose up -d --wait postgres
npm run db:migrate:test
npm run test:integration -- packages/database/tests/integration/optimistic-inventory.test.js
npm run test:unit -- packages/concurrency/tests/unit/optimistic-inventory.test.js
```

The repository updates stock only when the product still has the version that
was previously read. A successful update decrements stock and increments the
version atomically. No updated row means another writer won, stock is no longer
sufficient, or the product is absent.

The reservation coordinator reads fresh inventory after a conflict. It rejects
insufficient stock immediately and limits retries so sustained contention cannot
loop forever. `maxRetries` counts retries after the first attempt.

Use optimistic concurrency when conflicts are uncommon and short retries are
cheap. Under heavy contention, repeated reads and updates add database load;
consider backoff, jitter, or a pessimistic strategy. This experiment is not yet
connected to the order-processing path.
