export {
  simulateAtLeastOnce,
  simulateAtMostOnce,
  simulateIdempotentEffects,
} from './messaging-semantics.js';

export class QueueShutdownError extends Error {
  constructor() {
    super('Queue has shut down');
    this.name = 'QueueShutdownError';
    this.code = 'QUEUE_SHUTDOWN';
  }
}

export class InvalidQueueMessageError extends Error {
  constructor() {
    super('Queue message must be an object');
    this.name = 'InvalidQueueMessageError';
    this.code = 'INVALID_QUEUE_MESSAGE';
  }
}

export class InvalidQueueCapacityError extends RangeError {
  constructor() {
    super('Queue capacity must be a positive integer');
    this.name = 'InvalidQueueCapacityError';
    this.code = 'INVALID_QUEUE_CAPACITY';
  }
}

export class InvalidOverflowStrategyError extends RangeError {
  constructor() {
    super('Queue overflow strategy must be reject or wait');
    this.name = 'InvalidOverflowStrategyError';
    this.code = 'INVALID_OVERFLOW_STRATEGY';
  }
}

export class QueueCapacityExceededError extends Error {
  constructor() {
    super('Queue capacity has been reached');
    this.name = 'QueueCapacityExceededError';
    this.code = 'QUEUE_CAPACITY_EXCEEDED';
  }
}

export function createInMemoryQueue({
  capacity = Number.POSITIVE_INFINITY,
  overflowStrategy = 'reject',
} = {}) {
  if (capacity !== Number.POSITIVE_INFINITY && (!Number.isInteger(capacity) || capacity <= 0)) {
    throw new InvalidQueueCapacityError();
  }

  if (overflowStrategy !== 'reject' && overflowStrategy !== 'wait') {
    throw new InvalidOverflowStrategyError();
  }

  const messages = [];
  const waitingPublishers = [];
  let acceptingWork = true;
  let activeConsumer = null;
  let wakeConsumer = null;

  function wake() {
    if (wakeConsumer) {
      wakeConsumer();
      wakeConsumer = null;
    }
  }

  function admitWaitingPublishers() {
    while (acceptingWork && messages.length < capacity && waitingPublishers.length > 0) {
      const publisher = waitingPublishers.shift();
      messages.push(publisher.message);
      publisher.resolve();
      wake();
    }
  }

  async function nextMessage() {
    while (acceptingWork && messages.length === 0) {
      await new Promise((resolve) => {
        wakeConsumer = resolve;
      });
    }

    return acceptingWork ? messages[0] : undefined;
  }

  async function runConsumer(handler) {
    while (acceptingWork) {
      const message = await nextMessage();

      if (!acceptingWork || !message) {
        return;
      }

      await handler(message);
      messages.shift();
      admitWaitingPublishers();
    }
  }

  return {
    async publish(message) {
      if (!acceptingWork) {
        throw new QueueShutdownError();
      }

      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        throw new InvalidQueueMessageError();
      }

      if (messages.length >= capacity) {
        if (overflowStrategy === 'reject') {
          throw new QueueCapacityExceededError();
        }

        return new Promise((resolve, reject) => {
          waitingPublishers.push({ message, resolve, reject });
        });
      }

      messages.push(message);
      wake();
    },

    consume(handler) {
      if (!acceptingWork) {
        return Promise.reject(new QueueShutdownError());
      }

      if (activeConsumer) {
        return Promise.reject(new Error('Queue already has an active consumer'));
      }

      const consuming = runConsumer(handler).finally(() => {
        if (activeConsumer === consuming) {
          activeConsumer = null;
        }
      });
      activeConsumer = consuming;
      return consuming;
    },

    getMetrics() {
      return {
        capacity,
        queueDepth: messages.length,
        waitingPublishers: waitingPublishers.length,
      };
    },

    async shutdown() {
      acceptingWork = false;
      wake();

      while (waitingPublishers.length > 0) {
        waitingPublishers.shift().reject(new QueueShutdownError());
      }

      if (activeConsumer) {
        await activeConsumer.catch(() => undefined);
      }
    },
  };
}
