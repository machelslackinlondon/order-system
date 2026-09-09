# Experiment command guidance

Each command runs a deterministic local scenario, prints the observable state change, explains the
result, and identifies its source and introducing commits:

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

The commands require no database, Redis server, or network access. They reuse the real local
concurrency, queue, retry, worker-pool, and lock APIs where practical; the pessimistic-lock command
uses a deterministic exclusive-access simulation while its PostgreSQL behavior remains covered by
the focused integration test.

These scenarios demonstrate one behavior at a time and do not start the application runtime. Use
the printed source path to inspect the implementation and the printed commit hashes to inspect its
TDD history. The CLI accepts exactly one command name and prints usage guidance for missing or extra
arguments.

Focused verification:

```bash
npm run test:unit -- packages/experiments/tests/unit
```
