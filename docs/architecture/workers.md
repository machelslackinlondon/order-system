# Worker pool guidance

The local worker pool accepts jobs with `submit(job)` and processes them through an injected
handler. `WORKER_CONCURRENCY` defaults to `5` and must be a positive integer.

Jobs wait in first-in-first-out order. At most the configured number run simultaneously. Each
submission resolves with its handler result or rejects with its handler error; one failure does not
stop later jobs.

`shutdown()` stops new submissions and drains all accepted jobs before resolving. Calls to
`submit()` after shutdown begins reject with `WORKER_POOL_SHUTDOWN`.

## Metrics

`getMetrics()` reports the configured concurrency, queued and active work, completed, successful,
and failed jobs, cumulative and average processing time, and completed-job throughput since pool
creation. The injected clock keeps timing tests deterministic.

The pool is intentionally independent of the local queue. Queue acknowledgement must remain tied
to completed processing, so the queue-to-pool bridge belongs in a later phase that defines that
delivery boundary explicitly.
