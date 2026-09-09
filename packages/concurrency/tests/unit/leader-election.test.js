import { describe, expect, it } from '@jest/globals';

import * as concurrency from '../../src/index.js';

const workerIds = ['worker-a', 'worker-b', 'worker-c'];

function createFakeClock() {
  let currentTime = 0;

  return {
    advance(milliseconds) {
      currentTime += milliseconds;
    },
    now() {
      return currentTime;
    },
    set(timestamp) {
      currentTime = timestamp;
    },
  };
}

function createSimulation(options = {}) {
  const clock = options.clock ?? createFakeClock();

  expect(concurrency.createLeaderElectionSimulation).toEqual(expect.any(Function));

  return {
    clock,
    simulation: concurrency.createLeaderElectionSimulation({
      workerIds,
      heartbeatTimeoutMs: 100,
      now: clock.now,
      ...options,
    }),
  };
}

describe('leader election simulation', () => {
  it('elects the first configured worker when no leader exists', () => {
    const { simulation } = createSimulation();

    expect(simulation.getLeader()).toBeNull();
    expect(simulation.electLeader()).toBe('worker-a');
    expect(simulation.getLeader()).toBe('worker-a');
  });

  it('keeps the current leader when it heartbeats before the timeout', () => {
    const { clock, simulation } = createSimulation();
    simulation.electLeader();

    clock.advance(90);
    simulation.heartbeat('worker-a');
    clock.advance(90);

    expect(simulation.checkLeader()).toBe('worker-a');
  });

  it('elects the next worker when the leader heartbeat reaches its timeout', () => {
    const { clock, simulation } = createSimulation();
    simulation.electLeader();

    clock.advance(99);
    expect(simulation.checkLeader()).toBe('worker-a');

    clock.advance(1);
    expect(simulation.checkLeader()).toBe('worker-b');
    expect(simulation.getLeader()).toBe('worker-b');
  });

  it('rejects a heartbeat from a leader whose timeout has already elapsed', () => {
    const { clock, simulation } = createSimulation();
    simulation.electLeader();

    clock.advance(100);

    expect(() => simulation.heartbeat('worker-a')).toThrow(
      'Only the current leader can send a heartbeat',
    );
    expect(simulation.getLeader()).toBe('worker-b');
  });

  it('skips each failed leader during later elections', () => {
    const { clock, simulation } = createSimulation();
    simulation.electLeader();

    clock.advance(100);
    expect(simulation.checkLeader()).toBe('worker-b');

    clock.advance(100);
    expect(simulation.checkLeader()).toBe('worker-c');
  });

  it('reports no leader after every worker has timed out', () => {
    const { clock, simulation } = createSimulation();
    simulation.electLeader();

    clock.advance(100);
    simulation.checkLeader();
    clock.advance(100);
    simulation.checkLeader();
    clock.advance(100);

    expect(simulation.checkLeader()).toBeNull();
    expect(simulation.getLeader()).toBeNull();
  });

  it('rejects heartbeats from a follower', () => {
    const { simulation } = createSimulation();
    simulation.electLeader();

    expect(() => simulation.heartbeat('worker-b')).toThrow(
      'Only the current leader can send a heartbeat',
    );
  });

  it('rejects heartbeats from an unknown worker', () => {
    const { simulation } = createSimulation();

    expect(() => simulation.heartbeat('worker-z')).toThrow('Unknown worker ID: worker-z');
  });

  it.each([
    { label: 'a missing list', ids: undefined },
    { label: 'a non-array list', ids: 'worker-a' },
    { label: 'too few workers', ids: ['worker-a'] },
    { label: 'duplicate IDs', ids: ['worker-a', 'worker-a'] },
    { label: 'an empty ID', ids: ['worker-a', ''] },
    { label: 'a non-string ID', ids: ['worker-a', 2] },
  ])('rejects a topology with $label', ({ ids }) => {
    expect(() =>
      concurrency.createLeaderElectionSimulation({
        workerIds: ids,
        heartbeatTimeoutMs: 100,
        now: () => 0,
      }),
    ).toThrow('Leader election requires at least two distinct non-empty worker IDs');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid heartbeat timeout %s', (timeout) => {
    expect(() =>
      concurrency.createLeaderElectionSimulation({
        workerIds,
        heartbeatTimeoutMs: timeout,
        now: () => 0,
      }),
    ).toThrow('Heartbeat timeout must be a positive integer');
  });

  it('rejects a non-function clock', () => {
    expect(() =>
      concurrency.createLeaderElectionSimulation({
        workerIds,
        heartbeatTimeoutMs: 100,
        now: 0,
      }),
    ).toThrow('Leader election clock must be a function');
  });

  it('rejects a non-finite clock value before electing a leader', () => {
    const clock = createFakeClock();
    const { simulation } = createSimulation({ clock });
    clock.set(Number.NaN);

    expect(() => simulation.electLeader()).toThrow(
      'Leader election clock must return a finite number',
    );
    expect(simulation.getLeader()).toBeNull();
  });

  it('rejects a non-finite heartbeat time without changing the leader', () => {
    const clock = createFakeClock();
    const { simulation } = createSimulation({ clock });
    simulation.electLeader();
    clock.set(Number.NaN);

    expect(() => simulation.heartbeat('worker-a')).toThrow(
      'Leader election clock must return a finite number',
    );
    expect(simulation.getLeader()).toBe('worker-a');
  });

  it('rejects a non-finite failure-check time without changing the leader', () => {
    const clock = createFakeClock();
    const { simulation } = createSimulation({ clock });
    simulation.electLeader();
    clock.set(Number.NaN);

    expect(() => simulation.checkLeader()).toThrow(
      'Leader election clock must return a finite number',
    );
    expect(simulation.getLeader()).toBe('worker-a');
  });
});
