# Retry and dead-letter guidance

Use `executeWithRetry()` around asynchronous message processing that can fail temporarily. The
operation receives the original message and `{ attempt, maxAttempts }`, allowing logs and metrics
to identify each try without changing the message.

Throw `TransientError` only when repeating the same operation is safe and may succeed, such as a
temporary dependency outage. Throw `PermanentError` for invalid or non-recoverable work. Unknown
errors are treated as permanent so programming faults do not create retry storms.

The default policy makes five attempts with delays centred on 1, 2, 4, and 8 seconds. Each delay
has plus-or-minus 20% jitter to spread concurrent retries. Maximum attempts, base delay, jitter,
timer, random source, and clock are injectable; production uses real time while tests avoid waits.

Permanent failures go directly to the supplied local dead-letter queue. Transient failures go
there after the final attempt. The dead-letter record contains the original message, attempt count,
classification, timestamps, and a safe summary of the last error. Processing then rejects with
`MESSAGE_DEAD_LETTERED`, keeping failure visible to the caller.

Retry only idempotent operations. Backoff reduces pressure but does not make duplicate side effects
safe, and a dead-letter queue still needs monitoring and an explicit replay process. The retry
policy is currently independent of the worker pool and queue consumer; their integration should
acknowledge a source message only after processing or dead-letter publication completes.
