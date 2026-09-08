# Inventory lost-update race

Run the experiment with:

```bash
npm run test:unit -- packages/concurrency/tests/unit/unsafe-inventory.test.js
```

Two concurrent reservations both read stock `10`, both approve a quantity of
`3`, and both write stock `7`. The correct result is `4`, so the final value
violates the invariant that stock equals starting stock minus every successful
reservation.

The unsafe read-check-write sequence appears correct when requests run one at a
time because each request sees the previous write. Concurrent requests can read
the same stale value before either writes. This implementation is educational
only and is not connected to the order-processing application.
