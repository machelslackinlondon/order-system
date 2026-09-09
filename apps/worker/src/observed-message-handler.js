export function createObservedMessageHandler({ handler, workerId, observability }) {
  return async function observedMessageHandler(message) {
    const operation = observability.startOperation({
      event: 'message.process',
      context: observability.createMessageContext({ message, workerId }),
    });

    try {
      const result = await handler(message);
      const duplicate = result?.status === 'DUPLICATE';
      operation.complete({
        status: duplicate ? 'DUPLICATE' : 'COMPLETED',
        counters: [duplicate ? 'deduplication_count' : 'orders_completed_total'],
      });
      return result;
    } catch (error) {
      operation.fail(error, { status: 'FAILED', counters: ['orders_failed_total'] });
      throw error;
    }
  };
}
