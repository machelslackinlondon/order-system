# PostgreSQL isolation-level guidance

The focused experiments use separate database transactions and explicit promise barriers, so their ordering does not depend on sleeps.

- **READ COMMITTED** takes a new snapshot for each statement. A transaction can therefore read one value, wait for another transaction to commit, and then read the newer value.
- **REPEATABLE READ** keeps one snapshot for the transaction. Repeated reads remain stable even when a concurrent transaction commits a change.
- **SERIALIZABLE** rejects transactions when their concurrent result cannot be equivalent to a serial order. PostgreSQL reports SQLSTATE `40001`; retry the complete transaction with a bounded retry policy.

Use `READ COMMITTED` for ordinary short transactions whose decisions do not depend on stable repeated reads. Use `REPEATABLE READ` for a consistent multi-query snapshot. Use `SERIALIZABLE` when correctness is easiest to express as if transactions ran one at a time and the application can safely retry conflicts.

Run the experiments with:

```bash
npm run test:integration -- packages/database/tests/integration/isolation-levels.test.js
```
