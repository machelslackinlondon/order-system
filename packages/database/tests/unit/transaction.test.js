import { describe, expect, it } from '@jest/globals';

import { DatabaseUnavailableError, withTransaction } from '../../src/index.js';

describe('withTransaction', () => {
  it('preserves the operation error and discards the client when rollback fails', async () => {
    const operationError = new Error('processing failed');
    const rollbackError = Object.assign(new Error('connection lost during rollback'), {
      code: 'ECONNRESET',
    });
    const queries = [];
    let releasedWith;
    const client = {
      async query(command) {
        queries.push(command);
        if (command === 'ROLLBACK') {
          throw rollbackError;
        }
      },
      release(error) {
        releasedWith = error;
      },
    };
    const pool = {
      async connect() {
        return client;
      },
    };

    const error = await withTransaction(pool, async () => {
      throw operationError;
    }).catch((caught) => caught);

    expect(error).toBe(operationError);
    expect(queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(releasedWith).toBe(rollbackError);
  });

  it('translates pool connection failures', async () => {
    const cause = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const pool = {
      async connect() {
        throw cause;
      },
    };

    const error = await withTransaction(pool, async () => undefined).catch((caught) => caught);

    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error.cause).toBe(cause);
  });

  it('translates begin failures and discards the client', async () => {
    const cause = Object.assign(new Error('begin timed out'), { code: 'ETIMEDOUT' });
    let releasedWith;
    const client = {
      async query() {
        throw cause;
      },
      release(error) {
        releasedWith = error;
      },
    };
    const pool = {
      async connect() {
        return client;
      },
    };

    const error = await withTransaction(pool, async () => undefined).catch((caught) => caught);

    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error.cause).toBe(cause);
    expect(releasedWith).toBe(cause);
  });

  it('translates commit failures, rolls back, and discards the client', async () => {
    const cause = Object.assign(new Error('commit connection failure'), { code: '08006' });
    const queries = [];
    let releasedWith;
    const client = {
      async query(command) {
        queries.push(command);
        if (command === 'COMMIT') {
          throw cause;
        }
      },
      release(error) {
        releasedWith = error;
      },
    };
    const pool = {
      async connect() {
        return client;
      },
    };

    const error = await withTransaction(pool, async () => 'reserved').catch((caught) => caught);

    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error.cause).toBe(cause);
    expect(queries).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
    expect(releasedWith).toBe(cause);
  });
});
