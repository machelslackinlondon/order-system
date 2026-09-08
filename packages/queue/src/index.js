export class QueueShutdownError extends Error {
  constructor() {
    super('Queue has shut down');
    this.name = 'QueueShutdownError';
    this.code = 'QUEUE_SHUTDOWN';
  }
}

export function createInMemoryQueue() {
  const messages = [];
  let acceptingWork = true;
  let activeConsumer = null;
  let wakeConsumer = null;

  function wake() {
    if (wakeConsumer) {
      wakeConsumer();
      wakeConsumer = null;
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

      if (!message) {
        return;
      }

      await handler(message);
      messages.shift();
    }
  }

  return {
    async publish(message) {
      if (!acceptingWork) {
        throw new QueueShutdownError();
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

    async shutdown() {
      acceptingWork = false;
      wake();

      if (activeConsumer) {
        await activeConsumer.catch(() => undefined);
      }
    },
  };
}
