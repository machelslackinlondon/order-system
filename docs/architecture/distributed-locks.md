# Distributed lock guidance

`createRedisLock()` acquires a single-Redis lease with `SET NX PX`. A successful acquisition
returns the resource, a unique owner token, and its TTL; contention returns `null`. Redis command
failures instead reject with `REDIS_LOCK_UNAVAILABLE`, so an outage is never mistaken for another
worker owning the lock.

An acquisition error has an unknown outcome: Redis may have stored the lease before the response
was lost. The caller must not enter the protected section and must not assume an immediate retry
owns a fresh lease. Wait for the TTL or reconcile the protected operation. A release error is also
an unknown outcome, so cleanup must remain idempotent.

Release uses an atomic Lua script that deletes the key only when its stored token matches the
lease. This prevents an expired worker from deleting a replacement worker's lock. Renewal is not
implemented, so work must fit within the TTL and the lease must always be released in cleanup code.

A TTL limits how long a stale lock survives; it does not stop an expired owner from continuing its
work while a replacement owner starts. Critical writes need an additional fencing token or an
idempotent transactional boundary. This single-instance implementation also does not provide the
multi-node fault tolerance of Redlock. A Redis restart without suitable persistence can lose active
leases, while a network partition can make the lock unavailable or let work outlive its lease.

Prefer a database transaction, unique constraint, or idempotency key when the protected state is
already in PostgreSQL. A distributed lock is appropriate only when independent processes must
coordinate access to a shared resource and the lease's failure modes are acceptable. See the
[official Redis lock pattern](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
for the underlying guarantees and limitations.
