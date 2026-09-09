# CAP guidance

CAP constrains a replicated service while communication between replicas is broken. It is not a
general instruction to “pick any two.” During a partition, the service must choose per operation
whether to preserve one authoritative history or continue answering on both sides.

For this order system:

- **Consistency** means successful order and inventory operations agree with one serial history. A
  confirmed reservation must not oversell stock, and retries must resolve to the same order.
- **Availability** means every request reaching a healthy node eventually receives a response. A
  normal business rejection can be valid; refusing an otherwise valid operation only because
  replicas cannot communicate gives up CAP availability, even when a quick `503` is operationally
  useful.
- **Partition tolerance** means the chosen guarantees still hold when messages between nodes are
  delayed or lost. Once state is distributed, network partitions cannot be designed away.

## Partition scenario

The simulation starts two isolated inventory replicas at stock `5`. Each receives a quantity-`3`
reservation:

| Policy | Partition response                                                     | Result                                                                                                                            |
| ------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| CP     | Both replicas reject writes they cannot coordinate with the authority. | Stock remains consistent, but order creation is unavailable on those replicas.                                                    |
| AP     | Both replicas accept against their local stock.                        | Both remain available, but reconciliation discovers `6` units accepted against `5`. One order needs compensation or cancellation. |

Run it with:

```bash
npm run test:unit -- packages/concurrency/tests/unit/cap-partition.test.js
```

The current API and PostgreSQL deployment use one authoritative database, not replicated inventory.
If the API cannot reach PostgreSQL, it fails the write instead of inventing a local success. That is
a consistency-first boundary, although a single database is not by itself a fault-tolerant CP
cluster. The Redis lock also fails closed when ownership cannot be confirmed; its TTL still means
critical writes need transactional or idempotent protection.

The local queue is process-local and volatile, so it provides neither replicated availability nor
partition recovery. A future replicated order-status view, catalog cache, or analytics stream may
prefer AP behavior because stale data can be repaired. Inventory decrements, payment decisions, and
authoritative order transitions should prefer consistency and return a retryable failure when their
authority cannot be reached.

The [Gilbert and Lynch result](https://dl.acm.org/doi/10.1145/564585.564601) formalizes why a
partitioned service cannot guarantee both atomic consistency and availability.
