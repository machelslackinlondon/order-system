import Fastify from 'fastify';
import { DatabaseUnavailableError } from '@order-system/database';

import { OrderApplicationError } from './order-errors.js';
import { registerOrdersRoute } from './orders-route.js';

const requestValidationErrorCodes = new Set([
  'FST_ERR_CTP_EMPTY_JSON_BODY',
  'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_INVALID_MEDIA_TYPE',
]);

function errorBody(code, message) {
  return { error: { code, message } };
}

export function buildApp({ orderService, logger = false }) {
  const app = Fastify({
    logger,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
      },
    },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation || requestValidationErrorCodes.has(error.code)) {
      return reply.code(400).send(errorBody('VALIDATION_ERROR', 'Invalid request'));
    }

    if (error instanceof OrderApplicationError) {
      const message = error.code === 'VALIDATION_ERROR' ? 'Invalid request' : error.message;
      return reply.code(error.statusCode).send(errorBody(error.code, message));
    }

    if (error instanceof DatabaseUnavailableError || error.code === 'DATABASE_UNAVAILABLE') {
      return reply.code(503).send(errorBody('DATABASE_UNAVAILABLE', 'Database unavailable'));
    }

    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Internal server error'));
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(registerOrdersRoute, { orderService });

  return app;
}
