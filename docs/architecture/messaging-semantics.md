# Messaging semantics

Delivery guarantees describe what the transport may present to a consumer. Processing guarantees
describe whether a business effect is applied more than once. They are related, but they are not the
same guarantee.

## At-most-once delivery

```text
message -> one transport attempt -> process -> acknowledge
                   |
                   +-> loss: no retry, no business effect
```

At-most-once delivery avoids duplicate presentation by making only one attempt. If that attempt is
lost before the handler runs, the message and its intended effect are lost.

## At-least-once delivery

```text
message -> process -> acknowledgement lost -> retry -> process again
```

At-least-once delivery retries an unacknowledged message. It reduces message loss, but an ambiguous
acknowledgement can cause the same message to reach processing more than once. Without application
protection, each attempt may repeat the business effect.

## Exactly-once delivery and effects

Exactly-once delivery would require the transport to present a message precisely once across every
crash and ambiguous acknowledgement. That end-to-end promise is generally impractical to assume.

Exactly-once effects are an application-level outcome. The transport may redeliver, while a stable
message or idempotency key, a durable deduplication record, and a transaction ensure the business
effect commits once. A duplicate still invokes the consumer at the deduplication boundary, while
the protected business operation is not repeated. External side effects need their own idempotency
keys or an equivalent durable protocol.

## What this repository demonstrates

The deterministic queue simulations count transport attempts, consumer-handler invocations, and
effect applications:

- at-most-once loss: one transport attempt, no handler invocation, no effect;
- at-least-once acknowledgement loss: two attempts, two handler invocations, two effects;
- idempotent effects: two attempts, two handler invocations, one effect, one duplicate skipped.

The local queue removes a message after its handler resolves and keeps a rejected message at the
head for another in-process attempt. The acknowledgement-loss simulations apply the effect and then
reject the handler as a local stand-in for an ambiguous acknowledgement, so the next consumer
attempt receives the retained message. This does not create an independently durable acknowledgement
boundary: the queue remains process-local and cannot recover messages after restart. PostgreSQL's
`processed_messages` claim protects the demonstrated database effect transactionally; it does not
make the local transport exactly-once.

Run the focused examples with:

```bash
npm run test:unit -- packages/queue/tests/unit/messaging-semantics.test.js
```
