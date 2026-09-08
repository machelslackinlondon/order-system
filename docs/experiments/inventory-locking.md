# Inventory locking guidance

Run the focused pessimistic-locking examples with:

```bash
docker compose up -d --wait postgres
npm run db:migrate:test
npm run test:integration -- packages/concurrency/tests/integration/pessimistic-inventory.test.js
```

| Strategy    | Coordination                             | Prefer when                              | Main cost                             |
| ----------- | ---------------------------------------- | ---------------------------------------- | ------------------------------------- |
| Optimistic  | Version check and bounded retry          | Conflicts are uncommon                   | Conflicts repeat reads and writes     |
| Pessimistic | `SELECT ... FOR UPDATE` in a transaction | Contention is frequent and work is short | Waiting reduces concurrent throughput |

Pessimistic reservation locks the product row, checks stock, updates inventory,
and commits as one transaction. Concurrent writers wait and then read the latest
stock. Errors roll back the transaction and release the row lock.

Keep locked transactions short, acquire multiple locks in a consistent order,
and never hold a database lock while calling an external service. These practices
reduce contention and deadlock risk. The strategy remains separate from the main
order-processing path until a later transaction or worker phase selects it.
