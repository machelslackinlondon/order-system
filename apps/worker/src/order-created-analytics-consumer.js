function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCanonicalTimestamp(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isValidEvent(event) {
  return (
    event !== null &&
    typeof event === 'object' &&
    event.type === 'ORDER_CREATED' &&
    isNonEmptyString(event.messageId) &&
    isNonEmptyString(event.orderId) &&
    isCanonicalTimestamp(event.timestamp)
  );
}

export class InvalidOrderCreatedEventError extends TypeError {
  constructor() {
    super('Invalid ORDER_CREATED event');
    this.name = 'InvalidOrderCreatedEventError';
    this.code = 'INVALID_ORDER_CREATED_EVENT';
  }
}

export function createOrderCreatedAnalyticsConsumer({ writeRecord }) {
  const claimedMessageIds = new Set();

  return {
    async handle(event) {
      if (!isValidEvent(event)) {
        throw new InvalidOrderCreatedEventError();
      }

      if (claimedMessageIds.has(event.messageId)) {
        return { status: 'DUPLICATE' };
      }

      claimedMessageIds.add(event.messageId);

      try {
        await writeRecord({
          messageId: event.messageId,
          orderId: event.orderId,
          occurredAt: event.timestamp,
        });
        return { status: 'RECORDED' };
      } catch (error) {
        claimedMessageIds.delete(event.messageId);
        throw error;
      }
    },
  };
}
