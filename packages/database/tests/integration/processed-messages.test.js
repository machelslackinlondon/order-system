import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { createTestPool, resetDatabase } from './test-database.js';

const databaseApi = import('../../src/index.js');

describe('processed message persistence', () => {
  let pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('persists a message identifier with its processing timestamp', async () => {
    const { createProcessedMessageRepository } = await databaseApi;
    const processedMessages = createProcessedMessageRepository(pool);

    const record = await processedMessages.tryCreate('message-123');

    expect(record).toEqual({
      messageId: 'message-123',
      processedAt: expect.any(Date),
    });
    await expect(processedMessages.findByMessageId('message-123')).resolves.toEqual(record);
  });

  it('returns no new record when the message identifier already exists', async () => {
    const { createProcessedMessageRepository } = await databaseApi;
    const processedMessages = createProcessedMessageRepository(pool);
    await processedMessages.tryCreate('message-123');

    await expect(processedMessages.tryCreate('message-123')).resolves.toBeNull();
  });

  it('enforces message identifier uniqueness in PostgreSQL', async () => {
    await pool.query('INSERT INTO processed_messages (message_id) VALUES ($1)', ['message-123']);

    await expect(
      pool.query('INSERT INTO processed_messages (message_id) VALUES ($1)', ['message-123']),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
