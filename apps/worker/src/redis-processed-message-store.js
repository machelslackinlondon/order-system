function encodeKeyPart(value) {
  return encodeURIComponent(value);
}

export function createRedisProcessedMessageStore({
  client,
  keyPrefix = 'order-system:processed-message:',
}) {
  return {
    async tryClaim({ consumer, messageId, ttlSeconds }) {
      const key = `${keyPrefix}${encodeKeyPart(consumer)}:${encodeKeyPart(messageId)}`;
      const result = await client.set(key, '1', {
        condition: 'NX',
        expiration: { type: 'EX', value: ttlSeconds },
      });

      return result === 'OK';
    },
  };
}
