# Partitioning and sharding guidance

The production order path currently uses one PostgreSQL database. If order volume eventually
requires horizontal partitioning, route each order by a stable hash of `customerId`. Orders for one
customer then stay together, making customer history and idempotency checks single-partition
operations.

## Partition-key trade-offs

| Key          | Advantage                                     | Main cost                                                           |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------- |
| `customerId` | Co-locates a customer's orders and retries    | A very large customer can create a hot partition                    |
| `productId`  | Co-locates demand for one product             | Popular products become hot and customer histories scatter          |
| `orderId`    | Usually distributes writes and storage evenly | Customer and product queries must contact several or all partitions |

`customerId` is the best starting point for this system because its primary access pattern is
customer-owned order creation and history. Confirm the choice with production traffic and query
measurements before partitioning.

## Routing and distribution

The in-memory demonstration hashes `customerId`, applies modulo by the configured partition count,
and returns one partition ID. Every writer and reader must use the same routing function and
topology. Point operations carrying `customerId` go directly to one partition; requests without the
key need a lookup directory or scatter-gather query.

A hash spreads varied keys but cannot correct skew in the workload. Repeated traffic for one key
still reaches one partition, as the demonstration's hot-customer case shows. Monitor request rate,
storage, latency, and lock contention per partition. Mitigation may require isolating a large
customer, changing the key strategy, or splitting that customer's data with an explicit secondary
key and accepting more complex reads.

Changing the partition count in a simple modulo scheme remaps many keys. A production design needs
a controlled rebalance mechanism, such as a partition directory or consistent-hashing strategy,
while old and new routes coexist during migration.

## Cross-partition work

Queries spanning customers fan out, merge results, and need explicit timeout and partial-result
behavior. Global sorting and pagination become particularly expensive. Prefer a separate analytical
read model for reporting instead of querying every transactional partition.

Transactions across partitions add coordination, latency, and failure recovery. Keep inventory and
payment workflows asynchronous with idempotent messages and compensating actions instead of assuming
one database transaction can cover every partition.

Run the deterministic demonstration with:

```bash
npm run test:unit -- packages/concurrency/tests/unit/sharding.test.js
```
