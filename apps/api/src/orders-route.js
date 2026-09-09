import { createOrderSchema } from './order-schema.js';

const observabilityState = Symbol('orderObservabilityState');

export async function registerOrdersRoute(app, { orderService, observability }) {
  app.addHook('onRequest', (request, reply, done) => {
    const requestContext = observability?.createRequestContext({
      requestId: request.id,
      correlationId: request.headers['x-correlation-id'],
    });

    if (requestContext) {
      request[observabilityState] = { requestContext };
      reply.header('x-correlation-id', requestContext.correlationId);
    }

    done();
  });

  app.addHook('preHandler', (request, _reply, done) => {
    const state = request[observabilityState];
    if (state) {
      state.operation = observability.startOperation({
        event: 'order.create',
        context: state.requestContext,
      });
    }
    done();
  });

  app.addHook('onError', (request, _reply, error, done) => {
    const state = request[observabilityState];
    if (state?.operation && state.error === undefined) {
      state.error = error;
    }
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    const state = request[observabilityState];
    if (!state?.operation) {
      done();
      return;
    }

    if (state.error || reply.statusCode >= 400) {
      const error =
        state.error ??
        Object.assign(new Error(`Request failed with status ${reply.statusCode}`), {
          code: 'REQUEST_FAILED',
        });
      state.operation.fail(error, {
        status: 'FAILED',
        context: { orderId: state.orderId },
        counters: ['orders_failed_total'],
      });
    } else {
      state.operation.complete({
        status: 'CREATED',
        context: { orderId: state.orderId },
      });
    }
    done();
  });

  app.post('/orders', { schema: createOrderSchema }, async (request, reply) => {
    const requestContext = request[observabilityState]?.requestContext;

    const order = await orderService.createOrder({
      ...request.body,
      idempotencyKey: request.headers['idempotency-key'],
      ...(requestContext ? { requestContext } : {}),
    });

    const state = request[observabilityState];
    if (state) {
      state.orderId = order.id;
    }

    return reply.code(201).send(order);
  });
}
