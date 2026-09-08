import { describe, expect, it } from '@jest/globals';
import { createWorkerPool, resolveWorkerConcurrency } from '../../src/index.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('worker concurrency configuration', () => {
  it.each([
    [undefined, 5],
    ['3', 3],
    [2, 2],
  ])('resolves %p to %i workers', (value, expected) => {
    expect(resolveWorkerConcurrency(value)).toBe(expected);
  });

  it.each([0, -1, '0', '1.5', 'many'])('rejects invalid concurrency %p', (value) => {
    expect(() => resolveWorkerConcurrency(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_WORKER_CONCURRENCY' }),
    );
  });
});

describe('worker pool', () => {
  it('never exceeds its configured concurrency', async () => {
    const releaseWorkers = deferred();
    const workersSaturated = deferred();
    let active = 0;
    let maximumActive = 0;
    const pool = createWorkerPool({
      concurrency: 3,
      async handler(job) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (active === 3) {
          workersSaturated.resolve();
        }
        await releaseWorkers.promise;
        active -= 1;
        return job;
      },
    });

    const jobs = Array.from({ length: 1_000 }, (_, index) => pool.submit(index));
    await workersSaturated.promise;

    expect(pool.getMetrics()).toMatchObject({ activeWorkers: 3, queueDepth: 997 });
    releaseWorkers.resolve();
    await expect(Promise.all(jobs)).resolves.toHaveLength(1_000);
    expect(maximumActive).toBe(3);
    await pool.shutdown();
  });

  it('returns successful handler results', async () => {
    const pool = createWorkerPool({
      concurrency: 2,
      handler: async ({ value }) => value * 2,
    });

    await expect(pool.submit({ value: 21 })).resolves.toBe(42);
    await pool.shutdown();
  });

  it('continues processing after a job fails', async () => {
    const processingError = new Error('processing failed');
    const pool = createWorkerPool({
      concurrency: 1,
      async handler(job) {
        if (job === 'bad') {
          throw processingError;
        }
        return `${job}-processed`;
      },
    });

    const failed = expect(pool.submit('bad')).rejects.toBe(processingError);
    const succeeded = expect(pool.submit('good')).resolves.toBe('good-processed');

    await failed;
    await succeeded;
    expect(pool.getMetrics()).toMatchObject({ successfulJobs: 1, failedJobs: 1 });
    await pool.shutdown();
  });

  it('drains accepted jobs before completing graceful shutdown', async () => {
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const handled = [];
    const pool = createWorkerPool({
      concurrency: 1,
      async handler(job) {
        handled.push(job);
        if (job === 'first') {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
      },
    });
    const first = pool.submit('first');
    const second = pool.submit('second');
    await firstStarted.promise;

    let shutdownCompleted = false;
    const shuttingDown = pool.shutdown().then(() => {
      shutdownCompleted = true;
    });
    await Promise.resolve();

    expect(shutdownCompleted).toBe(false);
    await expect(pool.submit('late')).rejects.toMatchObject({ code: 'WORKER_POOL_SHUTDOWN' });
    releaseFirst.resolve();
    await Promise.all([first, second, shuttingDown]);
    expect(handled).toEqual(['first', 'second']);
    expect(pool.getMetrics()).toMatchObject({ activeWorkers: 0, queueDepth: 0 });
  });

  it('reports processing time and throughput', async () => {
    let time = 0;
    const processingError = new Error('failed');
    const pool = createWorkerPool({
      concurrency: 1,
      now: () => time,
      async handler(job) {
        time += job.duration;
        if (job.fails) {
          throw processingError;
        }
      },
    });

    const succeeded = pool.submit({ duration: 10, fails: false });
    const failed = expect(pool.submit({ duration: 20, fails: true })).rejects.toBe(processingError);
    await succeeded;
    await failed;

    expect(pool.getMetrics()).toEqual({
      concurrency: 1,
      queueDepth: 0,
      activeWorkers: 0,
      completedJobs: 2,
      successfulJobs: 1,
      failedJobs: 1,
      totalProcessingTimeMs: 30,
      averageProcessingTimeMs: 15,
      throughputPerSecond: 2000 / 30,
    });
    await pool.shutdown();
  });
});
