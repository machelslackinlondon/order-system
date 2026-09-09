import { createInMemoryQueue, simulateIdempotentEffects } from '@order-system/queue';
import { executeWithRetry, TransientError } from '@order-system/retries';
import { createWorkerPool } from '@order-system/worker';

async function runRetries() {
  const deadLetterQueue = createInMemoryQueue();
  const delays = [];
  let attempts = 0;

  try {
    await executeWithRetry({
      message: { messageId: 'message-1', type: 'ORDER_CREATED' },
      deadLetterQueue,
      maxAttempts: 3,
      jitterRatio: 0,
      delay: async (milliseconds) => delays.push(milliseconds),
      async operation() {
        attempts += 1;
        if (attempts < 3) {
          throw new TransientError('temporary dependency failure');
        }
        return 'processed';
      },
    });

    return {
      observations: [
        `Attempts: ${attempts}`,
        `Backoff delays: ${delays.map((delay) => `${delay}ms`).join(', ')}`,
        `Dead letters: ${deadLetterQueue.getMetrics().queueDepth}`,
      ],
      conclusion: 'Two transient failures backed off before the third attempt succeeded.',
    };
  } finally {
    await deadLetterQueue.shutdown();
  }
}

async function runDeduplication() {
  const state = await simulateIdempotentEffects({ acknowledgementLost: true });

  return {
    observations: [
      `Delivery attempts: ${state.deliveryAttempts}`,
      `Effect applications: ${state.effectApplications}`,
      `Duplicates skipped: ${state.duplicatesSkipped}`,
    ],
    conclusion: 'Redelivery repeated the handler but the stable message ID protected the effect.',
  };
}

async function runWorkerPool() {
  let activeWorkers = 0;
  let maximumActiveWorkers = 0;
  const pool = createWorkerPool({
    concurrency: 2,
    async handler(job) {
      activeWorkers += 1;
      maximumActiveWorkers = Math.max(maximumActiveWorkers, activeWorkers);
      await Promise.resolve();
      activeWorkers -= 1;
      return job;
    },
  });
  const jobs = Array.from({ length: 6 }, (_, index) => pool.submit(index));
  await Promise.all(jobs);
  const metrics = pool.getMetrics();
  await pool.shutdown();

  return {
    observations: [
      `Jobs submitted: ${jobs.length}`,
      `Maximum active workers: ${maximumActiveWorkers}`,
      `Successful jobs: ${metrics.successfulJobs}`,
    ],
    conclusion: 'The pool drained every job without exceeding its configured concurrency.',
  };
}

async function runBackpressure() {
  const queue = createInMemoryQueue({ capacity: 1 });
  let accepted = 0;
  let rejected = 0;

  try {
    await queue.publish({ messageId: 'message-1' });
    accepted += 1;
    await queue.publish({ messageId: 'message-2' });
    accepted += 1;
  } catch (error) {
    if (error.code !== 'QUEUE_CAPACITY_EXCEEDED') {
      throw error;
    }
    rejected += 1;
  } finally {
    await queue.shutdown();
  }

  return {
    observations: [
      'Queue capacity: 1',
      `Accepted messages: ${accepted}`,
      `Rejected messages: ${rejected}`,
    ],
    conclusion: 'The bounded queue rejected excess work instead of growing without limit.',
  };
}

export function createMessagingExperiments() {
  return new Map([
    [
      'retries',
      {
        title: 'Bounded transient retries',
        demonstrates: 'Exponential backoff retries safe transient failures without busy looping.',
        source: 'packages/retries/src/index.js',
        commits: ['c861e1c', 'fc4c983'],
        run: runRetries,
      },
    ],
    [
      'deduplication',
      {
        title: 'Idempotent message effects',
        demonstrates: 'A stable message ID prevents repeated effects after redelivery.',
        source: 'packages/queue/src/messaging-semantics.js',
        commits: ['10b051d', 'b4a0219'],
        run: runDeduplication,
      },
    ],
    [
      'worker-pool',
      {
        title: 'Bounded worker concurrency',
        demonstrates: 'A fixed worker count drains a backlog without unbounded parallelism.',
        source: 'apps/worker/src/worker-pool.js',
        commits: ['ebd2980', 'c69ef04'],
        run: runWorkerPool,
      },
    ],
    [
      'backpressure',
      {
        title: 'Bounded queue backpressure',
        demonstrates: 'Capacity limits shed excess load when producers outrun consumers.',
        source: 'packages/queue/src/index.js',
        commits: ['f8afd73', '97c4446'],
        run: runBackpressure,
      },
    ],
  ]);
}
