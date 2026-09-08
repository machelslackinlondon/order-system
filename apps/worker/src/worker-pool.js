import { performance } from 'node:perf_hooks';

const defaultConcurrency = 5;

export class InvalidWorkerConcurrencyError extends RangeError {
  constructor() {
    super('Worker concurrency must be a positive integer');
    this.name = 'InvalidWorkerConcurrencyError';
    this.code = 'INVALID_WORKER_CONCURRENCY';
  }
}

export class WorkerPoolShutdownError extends Error {
  constructor() {
    super('Worker pool has shut down');
    this.name = 'WorkerPoolShutdownError';
    this.code = 'WORKER_POOL_SHUTDOWN';
  }
}

export function resolveWorkerConcurrency(value) {
  const candidate = value === undefined ? defaultConcurrency : value;
  const concurrency = typeof candidate === 'string' ? Number(candidate) : candidate;

  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new InvalidWorkerConcurrencyError();
  }

  return concurrency;
}

export function createWorkerPool({
  handler,
  concurrency = process.env.WORKER_CONCURRENCY,
  now = () => performance.now(),
}) {
  const maximumWorkers = resolveWorkerConcurrency(concurrency);
  const pendingJobs = [];
  const startedAt = now();
  let acceptingJobs = true;
  let activeWorkers = 0;
  let successfulJobs = 0;
  let failedJobs = 0;
  let totalProcessingTimeMs = 0;
  let shutdownPromise;
  let resolveShutdown;

  function completeShutdownWhenIdle() {
    if (!acceptingJobs && activeWorkers === 0 && pendingJobs.length === 0 && resolveShutdown) {
      resolveShutdown();
      resolveShutdown = undefined;
    }
  }

  function dispatch() {
    while (activeWorkers < maximumWorkers && pendingJobs.length > 0) {
      const entry = pendingJobs.shift();
      activeWorkers += 1;
      void processJob(entry);
    }
  }

  async function processJob(entry) {
    const jobStartedAt = now();
    let failure;
    let result;

    try {
      result = await handler(entry.job);
      successfulJobs += 1;
    } catch (error) {
      failure = error;
      failedJobs += 1;
    } finally {
      totalProcessingTimeMs += Math.max(0, now() - jobStartedAt);
      activeWorkers -= 1;
      dispatch();
      completeShutdownWhenIdle();
    }

    if (failure) {
      entry.reject(failure);
    } else {
      entry.resolve(result);
    }
  }

  return {
    submit(job) {
      if (!acceptingJobs) {
        return Promise.reject(new WorkerPoolShutdownError());
      }

      const submitted = new Promise((resolve, reject) => {
        pendingJobs.push({ job, resolve, reject });
      });
      dispatch();
      return submitted;
    },

    getMetrics() {
      const completedJobs = successfulJobs + failedJobs;
      const elapsedTimeMs = Math.max(0, now() - startedAt);

      return {
        concurrency: maximumWorkers,
        queueDepth: pendingJobs.length,
        activeWorkers,
        completedJobs,
        successfulJobs,
        failedJobs,
        totalProcessingTimeMs,
        averageProcessingTimeMs: completedJobs === 0 ? 0 : totalProcessingTimeMs / completedJobs,
        throughputPerSecond: elapsedTimeMs === 0 ? 0 : (completedJobs * 1_000) / elapsedTimeMs,
      };
    },

    shutdown() {
      acceptingJobs = false;

      if (!shutdownPromise) {
        shutdownPromise = new Promise((resolve) => {
          resolveShutdown = resolve;
        });
      }

      completeShutdownWhenIdle();
      return shutdownPromise;
    },
  };
}
