import { createOrderSchema } from './order-schema.js';

export async function registerOrdersRoute(app, { orderService, observability }) {
  app.post('/orders', { schema: createOrderSchema }, async (request, reply) => {
    const requestContext = observability?.createRequestContext({
      requestId: request.id,
      correlationId: request.headers['x-correlation-id'],
    });
    const operation = requestContext
      ? observability.startOperation({ event: 'order.create', context: requestContext })
      : undefined;

    if (requestContext) {
      reply.header('x-correlation-id', requestContext.correlationId);
    }

    try {
      const order = await orderService.createOrder({
        ...request.body,
        idempotencyKey: request.headers['idempotency-key'],
        ...(requestContext ? { requestContext } : {}),
      });

      operation?.complete({
        status: 'CREATED',
        context: { orderId: order.id },
      });

      return reply.code(201).send(order);
    } catch (error) {
      operation?.fail(error, { status: 'FAILED', counters: ['orders_failed_total'] });
      throw error;
    }
  });
}
