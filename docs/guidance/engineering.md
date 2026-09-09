# Engineering guidance

Use these prompts when changing the system. Each answer points to focused guidance and executable
evidence rather than prescribing one technique for every workload.

## Concurrency decisions

| Ask                                               | Guidance                                                                                                                                                                       | Evidence                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Which invariant must survive concurrent requests? | Keep the stock check and update in one database transaction when reserving inventory. A read-modify-write sequence without coordination can lose updates.                      | [Transaction guidance](../architecture/transactions.md) and `npm run experiment:race-condition`                               |
| Are conflicts occasional or sustained?            | Prefer optimistic version checks with bounded retries for occasional conflicts. Prefer row locks when a hot record must serialize critical updates.                            | `npm run experiment:optimistic-lock`, `npm run experiment:pessimistic-lock`, and `packages/concurrency/tests/`                |
| What does order acceptance guarantee?             | The current HTTP path validates current stock and creates a `PENDING` order; it does not reserve inventory. Keep that boundary explicit until the atomic service is connected. | [Architecture overview](../architecture/overview.md) and `apps/api/src/create-order.js`                                       |
| How is the concurrency claim demonstrated?        | Use deterministic barriers and injected state so tests control the conflicting interleaving without timing sleeps.                                                             | `packages/concurrency/tests/unit/unsafe-inventory.test.js` and `packages/concurrency/tests/unit/optimistic-inventory.test.js` |
