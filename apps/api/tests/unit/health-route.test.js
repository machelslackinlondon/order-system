import { afterEach, describe, expect, it } from '@jest/globals';

import { buildApp } from '../../src/index.js';

describe('health route', () => {
  let app;

  afterEach(async () => {
    await app?.close();
  });

  it('reports that the API process is ready to receive requests', async () => {
    app = buildApp({
      orderService: {
        async create() {
          throw new Error('The order service must not run during a health check');
        },
      },
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
