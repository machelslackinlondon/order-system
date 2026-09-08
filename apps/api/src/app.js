import Fastify from 'fastify';
import { DatabaseUnavailableError } from '@distributed-order-system/database';

import { OrderApplicationError } from './order-errors.js';
import { registerOrdersRoute } from './orders-route.js';

function errorBody(code, message) {
  return { error: { code, message } };
}

export function buildApp({ orderService, logger = false }) {
  const app = Fastify({ logger });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send(errorBody('VALIDATION_ERROR', 'Invalid request'));
    }

    if (error instanceof OrderApplicationError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }

    if (error instanceof DatabaseUnavailableError || error.code === 'DATABASE_UNAVAILABLE') {
      return reply.code(503).send(errorBody('DATABASE_UNAVAILABLE', 'Database unavailable'));
    }

    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Internal server error'));
  });

  app.register(registerOrdersRoute, { orderService });

  return app;
}
