export function createOrderCreatedPublisher({ queue }) {
  return {
    publish(order, context = {}) {
      const requestId = context?.requestId;
      const correlationId = context?.correlationId ?? requestId;

      return queue.publish({
        messageId: `order-created:${order.id}`,
        type: 'ORDER_CREATED',
        orderId: order.id,
        timestamp: new Date(order.createdAt).toISOString(),
        ...(requestId ? { requestId } : {}),
        ...(correlationId ? { correlationId } : {}),
      });
    },
  };
}
