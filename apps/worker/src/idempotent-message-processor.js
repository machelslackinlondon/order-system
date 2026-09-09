import { createProcessedMessageRepository, withTransaction } from '@order-system/database';

export function createIdempotentMessageProcessor({ pool, handler }) {
  return {
    process(message) {
      return withTransaction(pool, async (client) => {
        const processedMessages = createProcessedMessageRepository(client);
        const record = await processedMessages.tryCreate(message.messageId);

        if (!record) {
          return { status: 'DUPLICATE' };
        }

        const result = await handler(message, { client });
        return { status: 'PROCESSED', result };
      });
    },
  };
}
