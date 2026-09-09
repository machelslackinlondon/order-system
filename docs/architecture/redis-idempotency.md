# Redis idempotency claims

The worker package includes an optional Redis processed-message store. It demonstrates a fast,
conditional claim without changing the default PostgreSQL-backed processor.

## Key and write model

Redis has one key rather than separate partition and sort keys. The adapter builds an encoded
composite key:

```text
order-system:processed-message:<consumer>:<message-id>
```

Including the consumer lets independent handlers claim the same message. Encoding each component
prevents separators inside identifiers from creating collisions.

The claim is one atomic command:

```text
SET <key> 1 NX EX <ttl-seconds>
```

`NX` permits one winner and returns no result for duplicates. `EX` bounds retention; once the TTL
expires, the message can be claimed again. The unit test uses a shared in-memory Redis double whose
conditional and expiry behavior depends on those options.

## Consistency and hotspots

A command against the local single Redis server is serialized atomically. This profile does not
model replicas or failover, where replication and acknowledged-write durability require separate
decisions.

In a clustered Redis deployment, the complete key is mapped to a hash slot. Avoid forcing every
consumer key into one fixed hash tag because a busy consumer could create a hot slot. A single hot
message key can still attract contention, although `SET NX` keeps its outcome deterministic.

## Redis or PostgreSQL

| Concern              | PostgreSQL processed messages         | Redis claim store                    |
| -------------------- | ------------------------------------- | ------------------------------------ |
| Conditional claim    | Unique constraint plus `ON CONFLICT`  | Atomic `SET NX`                      |
| Retention            | Explicit database cleanup             | TTL                                  |
| Business transaction | Claim and database effect commit once | Claim is separate from database work |
| Querying and audit   | Relational history                    | Key lookup                           |
| Current role         | Default worker implementation         | Isolated local example               |

Use PostgreSQL when the claim and business effect must commit in the same transaction. Redis can be
useful for short-lived, high-volume duplicate suppression when losing or expiring a claim is an
acceptable trade-off.

Run the focused example with:

```bash
npm run test:unit -- apps/worker/tests/unit/redis-processed-message-store.test.js
```
