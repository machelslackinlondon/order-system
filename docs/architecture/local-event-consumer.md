# Local event consumer

The worker exports a small `ORDER_CREATED` analytics consumer:

```text
ORDER_CREATED -> analytics consumer -> local analytics sink
```

The consumer validates the message type, nonblank message and order IDs, and the producer's
canonical UTC ISO timestamp before calling the injected sink. A valid event produces a compact
record containing `messageId`, `orderId`, and `occurredAt`.

## Duplicate and retry behavior

Message IDs are claimed before the sink runs. A repeated ID returns `DUPLICATE` while the first
call is in flight and after it completes successfully. If the sink rejects, the claim is removed
and the error is rethrown so the caller can retry the event.

The claim set is process-local. It is cleared on restart and does not coordinate multiple worker
processes. Use a durable shared claim store when those guarantees are required.

A retry is unambiguous only when the sink failed before committing the record. If a sink commits
and then reports failure, it must enforce idempotency by `messageId` to prevent a duplicate record.
The caller remains responsible for timeouts, backoff, and deciding when retries end.

The consumer is an isolated example and is not wired to the queue or worker runtime.

## Focused verification

```bash
npm run test:unit -- apps/worker/tests/unit/order-created-analytics-consumer.test.js
```
