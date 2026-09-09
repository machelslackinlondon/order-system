const message = { messageId: 'message-1', type: 'ORDER_CREATED' };

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

export function createMessagingSemanticsSimulations({ createQueue }) {
  async function simulateAtMostOnce({ messageLost = false } = {}) {
    const queue = createQueue();
    const state = {
      deliveryAttempts: 1,
      handlerInvocations: 0,
      effectApplications: 0,
      trace: ['delivery-attempted'],
    };
    let consuming;

    try {
      if (messageLost) {
        state.trace.push('message-lost');
        return state;
      }

      await queue.publish(message);
      const handled = deferred();
      consuming = queue.consume(async () => {
        state.handlerInvocations += 1;
        state.trace.push('handler-invoked');
        state.effectApplications += 1;
        state.trace.push('effect-applied', 'acknowledged');
        handled.resolve();
      });
      await handled.promise;

      return state;
    } finally {
      await queue.shutdown();
      await consuming;
    }
  }

  async function simulateRedelivery({ acknowledgementLost, idempotent }) {
    const queue = createQueue();
    const acknowledgementLostError = new Error('acknowledgement lost');
    const processedMessageIds = new Set();
    const state = {
      deliveryAttempts: 0,
      handlerInvocations: 0,
      effectApplications: 0,
      ...(idempotent ? { duplicatesSkipped: 0 } : {}),
      trace: [],
    };
    let consuming;

    async function handle(deliveredMessage) {
      state.deliveryAttempts += 1;
      state.handlerInvocations += 1;
      state.trace.push('delivery-attempted', 'handler-invoked');

      if (idempotent && processedMessageIds.has(deliveredMessage.messageId)) {
        state.duplicatesSkipped += 1;
        state.trace.push('duplicate-skipped', 'acknowledged');
        return;
      }

      state.effectApplications += 1;
      state.trace.push('effect-applied');
      processedMessageIds.add(deliveredMessage.messageId);

      if (acknowledgementLost && state.deliveryAttempts === 1) {
        state.trace.push('acknowledgement-lost');
        throw acknowledgementLostError;
      }

      state.trace.push('acknowledged');
    }

    try {
      await queue.publish(message);

      if (acknowledgementLost) {
        try {
          await queue.consume(handle);
        } catch (error) {
          if (error !== acknowledgementLostError) {
            throw error;
          }
        }
      }

      const acknowledged = deferred();
      consuming = queue.consume(async (deliveredMessage) => {
        await handle(deliveredMessage);
        acknowledged.resolve();
      });
      await acknowledged.promise;

      return state;
    } finally {
      await queue.shutdown();
      await consuming;
    }
  }

  return {
    simulateAtLeastOnce({ acknowledgementLost = false } = {}) {
      return simulateRedelivery({ acknowledgementLost, idempotent: false });
    },

    simulateAtMostOnce,

    simulateIdempotentEffects({ acknowledgementLost = false } = {}) {
      return simulateRedelivery({ acknowledgementLost, idempotent: true });
    },
  };
}
