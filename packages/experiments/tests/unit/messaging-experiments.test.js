import { describe, expect, it } from '@jest/globals';

import * as experimentsApi from '../../src/index.js';

describe('messaging and worker experiment commands', () => {
  it('exposes the requested messaging and worker commands', () => {
    expect(experimentsApi.createMessagingExperiments).toEqual(expect.any(Function));

    expect([...experimentsApi.createMessagingExperiments().keys()]).toEqual([
      'retries',
      'deduplication',
      'worker-pool',
      'backpressure',
    ]);
  });

  it.each([
    [
      'retries',
      {
        observations: ['Attempts: 3', 'Backoff delays: 1000ms, 2000ms', 'Dead letters: 0'],
        conclusion: 'Two transient failures backed off before the third attempt succeeded.',
      },
      'packages/retries/src/index.js',
      ['c861e1c', 'fc4c983'],
    ],
    [
      'deduplication',
      {
        observations: ['Delivery attempts: 2', 'Effect applications: 1', 'Duplicates skipped: 1'],
        conclusion:
          'Redelivery repeated the handler but the stable message ID protected the effect.',
      },
      'packages/queue/src/messaging-semantics.js',
      ['10b051d', 'b4a0219'],
    ],
    [
      'worker-pool',
      {
        observations: ['Jobs submitted: 6', 'Maximum active workers: 2', 'Successful jobs: 6'],
        conclusion: 'The pool drained every job without exceeding its configured concurrency.',
      },
      'apps/worker/src/worker-pool.js',
      ['ebd2980', 'c69ef04'],
    ],
    [
      'backpressure',
      {
        observations: ['Queue capacity: 1', 'Accepted messages: 1', 'Rejected messages: 1'],
        conclusion: 'The bounded queue rejected excess work instead of growing without limit.',
      },
      'packages/queue/src/index.js',
      ['f8afd73', '97c4446'],
    ],
  ])('runs the %s scenario', async (name, expected, source, commits) => {
    const experiment = experimentsApi.createMessagingExperiments().get(name);

    await expect(experiment.run()).resolves.toEqual(expected);
    expect(experiment).toMatchObject({ source, commits });
  });

  it('makes messaging commands available to the CLI', async () => {
    const lines = [];

    await expect(
      experimentsApi.runExperimentCli(['retries'], {
        write: (line) => lines.push(line),
        writeError: () => undefined,
      }),
    ).resolves.toBe(0);

    expect(lines).toEqual([
      'Experiment: Bounded transient retries',
      'Demonstrates: Exponential backoff retries safe transient failures without busy looping.',
      'Attempts: 3',
      'Backoff delays: 1000ms, 2000ms',
      'Dead letters: 0',
      'Result: Two transient failures backed off before the third attempt succeeded.',
      'Source: packages/retries/src/index.js',
      'Commits: c861e1c, fc4c983',
    ]);
  });
});
