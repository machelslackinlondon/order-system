export function createObservedMessageHandler({ handler, workerId, observability }) {
  return async function observedMessageHandler(message) {
    const operation = observability.startOperation({
      event: 'message.process',
      context: observability.createMessageContext({ message, workerId }),
    });

    try {
      const result = await handler(message);
      operation.complete({
        status: 'COMPLETED',
        counters: ['orders_completed_total'],
      });
      return result;
    } catch (error) {
      operation.fail(error, { status: 'FAILED', counters: ['orders_failed_total'] });
      throw error;
    }
  };
}
