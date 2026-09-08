# Backpressure guidance

Create the local queue with a positive `capacity` to bound unacknowledged messages. Queue depth
includes the message currently being handled because it is not removed until acknowledgement.
Omitting capacity preserves the unbounded compatibility mode.

When the queue is full, `overflowStrategy: 'reject'` immediately returns
`QUEUE_CAPACITY_EXCEEDED`. Use this for load shedding when callers can retry or fail fast. With
`overflowStrategy: 'wait'`, publishers pause in first-in-first-out order until acknowledged work
frees capacity. Shutdown rejects paused publishers rather than leaving them unresolved.

`getMetrics()` reports queue depth, configured capacity, and waiting publishers so overload and
worker recovery are visible.

## Choosing an overload strategy

- Queueing absorbs short bursts but must have a limit.
- Rate limiting controls how quickly producers create work.
- Bounded worker pools cap downstream concurrency and resource usage.
- Load shedding rejects excess work to preserve service health.
- Producer throttling waits for capacity when delaying the producer is safe.

The right choice depends on whether the caller can wait, retry safely, or tolerate rejection. A
bounded queue and worker pool provide the baseline; rate limits and admission policy belong at the
external request boundary.
