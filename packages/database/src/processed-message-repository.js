import { mapProcessedMessage } from './mappers.js';
import { runQuery } from './query.js';

export function createProcessedMessageRepository(queryable) {
  return {
    async tryCreate(messageId) {
      const result = await runQuery(
        queryable,
        `
          INSERT INTO processed_messages (message_id)
          VALUES ($1)
          ON CONFLICT (message_id) DO NOTHING
          RETURNING message_id, processed_at
        `,
        [messageId],
      );

      return result.rowCount === 0 ? null : mapProcessedMessage(result.rows[0]);
    },

    async findByMessageId(messageId) {
      const result = await runQuery(
        queryable,
        `
          SELECT message_id, processed_at
          FROM processed_messages
          WHERE message_id = $1
        `,
        [messageId],
      );

      return result.rowCount === 0 ? null : mapProcessedMessage(result.rows[0]);
    },
  };
}
