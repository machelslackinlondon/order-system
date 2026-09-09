import { describe, expect, it } from '@jest/globals';

import * as experimentsApi from '../../src/index.js';

describe('experiment command runner', () => {
  it('runs a named scenario and explains its observable result', async () => {
    expect(experimentsApi.createExperimentRunner).toEqual(expect.any(Function));
    const lines = [];
    const runner = experimentsApi.createExperimentRunner({
      write: (line) => lines.push(line),
      experiments: new Map([
        [
          'inventory-race',
          {
            title: 'Inventory race',
            demonstrates: 'Concurrent read-modify-write can lose a reservation.',
            source: 'packages/concurrency/src/index.js',
            commits: ['test-sha', 'implementation-sha'],
            async run() {
              return {
                observations: ['Accepted reservations: 2', 'Final stock: 7'],
                conclusion: 'Both reservations succeeded, but only one stock update remained.',
              };
            },
          },
        ],
      ]),
    });

    await expect(runner.run('inventory-race')).resolves.toEqual({
      name: 'inventory-race',
      status: 'COMPLETED',
    });
    expect(lines).toEqual([
      'Experiment: Inventory race',
      'Demonstrates: Concurrent read-modify-write can lose a reservation.',
      'Accepted reservations: 2',
      'Final stock: 7',
      'Result: Both reservations succeeded, but only one stock update remained.',
      'Source: packages/concurrency/src/index.js',
      'Commits: test-sha, implementation-sha',
    ]);
  });

  it('reports the available commands for an unknown experiment', async () => {
    const runner = experimentsApi.createExperimentRunner({
      write: () => undefined,
      experiments: new Map([
        ['backpressure', {}],
        ['race-condition', {}],
      ]),
    });

    await expect(runner.run('missing')).rejects.toMatchObject({
      name: 'UnknownExperimentError',
      code: 'UNKNOWN_EXPERIMENT',
      experiment: 'missing',
      available: ['backpressure', 'race-condition'],
    });
  });
});
