import { describe, expect, it } from '@jest/globals';

import * as experimentsApi from '../../src/index.js';

describe('concurrency experiment commands', () => {
  it('exposes the requested concurrency commands', () => {
    expect(experimentsApi.createConcurrencyExperiments).toEqual(expect.any(Function));

    expect([...experimentsApi.createConcurrencyExperiments().keys()]).toEqual([
      'race-condition',
      'optimistic-lock',
      'pessimistic-lock',
      'idempotency',
      'distributed-lock',
    ]);
  });

  it.each([
    [
      'race-condition',
      {
        observations: ['Accepted reservations: 2', 'Expected stock: 4', 'Actual stock: 7'],
        conclusion: 'A lost update kept only one of two accepted reservations.',
      },
    ],
    [
      'optimistic-lock',
      {
        observations: ['Reservation attempts: 2', 'Final stock: 6', 'Final version: 3'],
        conclusion: 'The stale version conflicted, then a fresh read allowed a safe retry.',
      },
    ],
    [
      'pessimistic-lock',
      {
        observations: ['Completion order: order-1, order-2', 'Final stock: 4'],
        conclusion: 'Exclusive access serialized both reservations and preserved every update.',
      },
    ],
    [
      'idempotency',
      {
        observations: ['Requests: 3', 'Orders created: 1', 'Returned order IDs: order-1'],
        conclusion: 'Every retry resolved to the single result stored for its idempotency key.',
      },
    ],
    [
      'distributed-lock',
      {
        observations: [
          'Acquired leases: 1',
          'Second owner acquired: false',
          'Released by owner: true',
        ],
        conclusion: 'A token-owned lease admitted one owner and rejected its contender.',
      },
    ],
  ])('runs the %s scenario', async (name, expected) => {
    const experiment = experimentsApi.createConcurrencyExperiments().get(name);

    await expect(experiment.run()).resolves.toEqual(expected);
    expect(experiment.source).toEqual(expect.stringMatching(/^(apps|packages)\//));
    expect(experiment.commits).not.toEqual([]);
  });
});

describe('experiment CLI', () => {
  it('runs a selected concurrency command through the standard output contract', async () => {
    expect(experimentsApi.runExperimentCli).toEqual(expect.any(Function));
    const lines = [];

    await expect(
      experimentsApi.runExperimentCli(['race-condition'], {
        write: (line) => lines.push(line),
        writeError: () => undefined,
      }),
    ).resolves.toBe(0);

    expect(lines).toEqual([
      'Experiment: Lost inventory update',
      'Demonstrates: Concurrent read-modify-write can discard a valid stock reservation.',
      'Accepted reservations: 2',
      'Expected stock: 4',
      'Actual stock: 7',
      'Result: A lost update kept only one of two accepted reservations.',
      'Source: packages/concurrency/src/index.js',
      'Commits: 3c03007, be69c50',
    ]);
  });
});
