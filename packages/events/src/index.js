export function createOrderCreatedPublisher({ queue }) {
  return {
    publish(order) {
      return queue.publish({
        messageId: `order-created:${order.id}`,
        type: 'ORDER_CREATED',
        orderId: order.id,
        timestamp: new Date(order.createdAt).toISOString(),
      });
    },
  };
}
