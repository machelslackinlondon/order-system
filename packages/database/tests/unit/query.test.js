import { describe, expect, it, jest } from '@jest/globals';
import { DatabaseUnavailableError, runQuery } from '../../src/index.js';

describe('runQuery', () => {
  it.each([
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
    '08006',
    '57P01',
  ])('translates availability code %s', async (code) => {
    const cause = Object.assign(new Error('database detail'), { code });
    const queryable = { query: jest.fn().mockRejectedValue(cause) };

    const error = await runQuery(queryable, 'SELECT $1', [1]).catch((caught) => caught);

    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    expect(error.cause).toBe(cause);
  });

  it('preserves non-availability errors', async () => {
    const cause = Object.assign(new Error('constraint failed'), {
      code: '23514',
    });
    const queryable = { query: jest.fn().mockRejectedValue(cause) };

    await expect(runQuery(queryable, 'SELECT $1', [1])).rejects.toBe(cause);
  });
});
