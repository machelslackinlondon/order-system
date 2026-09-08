# Local queue guidance

The API publishes an `ORDER_CREATED` message after a new order wins the idempotent insert. A
matching retry returns the committed order without publishing another message.

Messages have a stable identifier derived from the order ID:

```text
order-created:<order-id>
```

They also contain `type`, `orderId`, and the order creation time as an ISO timestamp.

## Delivery semantics

The in-memory queue has one active consumer and delivers messages in first-in-first-out order.
A message is acknowledged only after its handler resolves. If the handler rejects, consumption
stops and that message remains at the head of the queue for the next consumer.

Shutdown rejects new publications, stops starting queued work, and waits for an in-flight handler
to finish. Pending messages are process-local and are lost when the process exits, so this adapter
is suitable for local development and deterministic tests rather than durable production delivery.

The `publish`, `consume`, and `shutdown` boundary keeps producers independent of the storage
mechanism. A durable adapter can implement the same behavior later without changing order-event
construction.

Order persistence and local publication are separate operations. If publication fails after the
database commit, the matching retry returns the order without republishing it. This phase therefore
provides best-effort publication, not atomic delivery; a durable transactional outbox is needed to
close that failure window.
