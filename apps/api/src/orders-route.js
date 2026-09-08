import { createOrderSchema } from './order-schema.js';

export async function registerOrdersRoute(app, { orderService }) {
  app.post('/orders', { schema: createOrderSchema }, async (request, reply) => {
    const order = await orderService.createOrder({
      ...request.body,
      idempotencyKey: request.headers['idempotency-key'],
    });

    return reply.code(201).send(order);
  });
}
