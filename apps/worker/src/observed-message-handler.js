export function createObservedMessageHandler({ handler, workerId, observability }) {
  return async function observedMessageHandler(message) {
    let operation;
    try {
      operation = observability.startOperation({
        event: 'message.process',
        context: observability.createMessageContext({ message, workerId }),
      });
    } catch {
      // Telemetry failures must not change message-processing outcomes.
    }

    try {
      const result = await handler(message);
      const duplicate = result?.status === 'DUPLICATE';
      try {
        operation?.complete({
          status: duplicate ? 'DUPLICATE' : 'COMPLETED',
          counters: [duplicate ? 'deduplication_count' : 'orders_completed_total'],
        });
      } catch {
        // Telemetry failures must not change message-processing outcomes.
      }
      return result;
    } catch (error) {
      try {
        operation?.fail(error, { status: 'FAILED', counters: ['orders_failed_total'] });
      } catch {
        // Telemetry failures must not replace the processing error.
      }
      throw error;
    }
  };
}
