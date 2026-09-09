# PostgreSQL replication guidance

The current system has one PostgreSQL instance. A future production topology could stream the
primary's write-ahead log to two hot standbys:

```text
Primary
   |
   +----> Replica 1
   |
   +----> Replica 2
```

## Read replicas and lag

All order and inventory writes continue through the primary. Hot standbys accept read-only queries
and can offload analytics, reporting, or other stale-tolerant reads. PostgreSQL streaming replication
is asynchronous by default, so a committed primary write can remain absent from a replica until its
WAL is received and replayed.

The simulation gives each replica its own queue. `writePrimary()` is visible through `readPrimary()`
immediately, while `readReplica()` stays stale until `replicateNext()` advances that replica. This
also shows that replicas can lag by different amounts and converge independently.

## Read-after-write routing

Sending a customer to a replica immediately after `POST /orders` may return `404` or an older status.
Use the primary for the write response and correctness-critical reads. For subsequent reads, choose
one explicit policy:

- keep the session on the primary for a bounded window;
- carry a required version or WAL position and wait until a replica has replayed it; or
- read a replica first and fall back to the primary when it has not reached the required version.

Inventory reservations, payment decisions, and order-state transitions must not use a potentially
stale replica. Analytics and non-authoritative history can usually tolerate lag.

## Failover

Failover needs external health checks and orchestration. Promote the most up-to-date eligible
standby, redirect write traffic, recreate stale connection pools, and fence the old primary before
it can accept writes again. Without fencing, two writable primaries can create divergent histories.

Asynchronous replication can lose transactions that had committed only on the failed primary.
Synchronous replication can reduce that recovery point by waiting for a standby, but it adds write
latency and can make writes unavailable when the required standby cannot acknowledge. Monitor WAL
receive/replay positions and rehearse promotion rather than treating replica presence as automatic
failover.

This phase adds no PostgreSQL standby or automatic promotion. See the
[PostgreSQL high-availability documentation](https://www.postgresql.org/docs/current/high-availability.html)
for the production mechanisms.

Run the deterministic simulation with:

```bash
npm run test:unit -- packages/concurrency/tests/unit/replication.test.js
```
