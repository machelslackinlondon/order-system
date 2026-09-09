# Consistency model guidance

An order does not need the same consistency guarantee in every view. The authoritative write path,
the customer's immediate response, and an analytics projection have different correctness needs.

```text
Order write -> PostgreSQL source -> event -> analytics/read model
                    |                            |
                    +-- immediately current     +-- may temporarily lag
```

## Strong consistency

Read the authoritative PostgreSQL state when a decision must use the latest committed order or
inventory value. The simulation's `readSource()` exposes a write immediately. This model suits
inventory reservations, payment decisions, and authoritative order transitions, where acting on a
stale value could spend stock twice or apply an invalid transition.

The current `POST /orders` path commits a `PENDING` order to PostgreSQL before responding. Its stock
check is advisory and does not reserve inventory, so the response must not be interpreted as a
strongly consistent reservation.

## Eventual consistency

A read model receives queued order versions after the source has committed them. Before
`applyNextReadModelUpdate()` runs, it can return no order or an older status. Applying every queued
version makes it converge to the source.

Temporary lag is acceptable for analytics, search, dashboards, and non-authoritative order history.
It is not acceptable for inventory, payment authorization, or state-transition validation. The
current local queue is volatile and publication is not atomic with the database write, so production
does not yet guarantee eventual convergence; that requires durable delivery or an outbox plus
idempotent consumers.

## Read-your-writes consistency

`writeOrder()` returns a token containing the order ID and minimum version observed by that session.
`readForSession()` uses the shared read model when it has reached that version and otherwise falls
back to the source. The customer therefore sees their own latest order while other readers may
temporarily see the lagging projection. The token is a consistency marker, not an authentication
credential.

Run the deterministic simulation with:

```bash
npm run test:unit -- packages/concurrency/tests/unit/consistency-models.test.js
```
