# Leader-election guidance

The in-memory simulation models three ordered workers and one active leader:

```text
Worker A ----+
Worker B ----+----> Leader
Worker C ----+
```

`electLeader()` selects the first healthy configured worker. Only that worker may call
`heartbeat()`. `checkLeader()` retains it while its most recent heartbeat is within the configured
timeout. At the timeout boundary, the simulation marks that worker failed and elects the next
healthy candidate. It returns `null` after all candidates fail.

Tests inject a fake clock, so heartbeat renewal and failure detection require no real waiting. Failed
workers do not recover, membership never changes, and every participant is assumed to share the
same ordered worker list. The simulation is not connected to the API, queue, or worker runtime.

## Production coordination

Real leader election requires agreement among independent processes. A network partition, delayed
heartbeat, process pause, or clock drift can otherwise make two workers believe they are leader.
Production designs need quorum decisions, durable election terms, and fencing tokens that prevent an
old leader from continuing to mutate shared state after a replacement is elected.

Use an established consensus-backed coordination system rather than extending this simulation. Such
systems have tested membership, persistence, failure recovery, and partition behavior. Clients must
still use bounded leases, renew them safely, reject stale fencing tokens, and stop leader-only work
when coordination becomes unavailable.

Run the deterministic simulation with:

```bash
npm run test:unit -- packages/concurrency/tests/unit/leader-election.test.js
```
