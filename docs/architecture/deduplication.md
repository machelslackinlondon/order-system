# Message deduplication guidance

At-least-once delivery can repeat a message after a consumer restart, timeout, or lost
acknowledgement even when the producer published it once. Consumers must therefore use the stable
`messageId` as an idempotency key.

`createIdempotentMessageProcessor()` starts a PostgreSQL transaction and attempts to insert the
message identifier into `processed_messages`. The primary key allows one concurrent delivery to
continue while later deliveries return `DUPLICATE`. The winning delivery invokes the handler and
commits its marker only after the handler succeeds. A handler failure rolls back the marker so a
later delivery can retry.

Database writes that must be atomic with the marker must use the transaction `client` supplied to
the handler. External calls cannot participate in the PostgreSQL transaction and still require
their own idempotency key or an outbox-style boundary.

The processor is currently independent of the local queue and worker pool. Future queue wiring
should acknowledge `PROCESSED` and `DUPLICATE` outcomes, but leave failed transactions available
for redelivery or retry handling.
