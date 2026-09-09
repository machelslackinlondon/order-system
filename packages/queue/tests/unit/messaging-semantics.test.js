import { describe, expect, it } from '@jest/globals';

import * as queue from '../../src/index.js';

function simulation(name) {
  expect(queue[name]).toEqual(expect.any(Function));
  return queue[name];
}

describe('messaging semantics simulations', () => {
  it('loses an at-most-once message without retrying it', () => {
    const simulateAtMostOnce = simulation('simulateAtMostOnce');

    expect(simulateAtMostOnce({ messageLost: true })).toEqual({
      deliveryAttempts: 1,
      handlerInvocations: 0,
      effectApplications: 0,
    });
  });

  it('repeats an at-least-once effect when acknowledgement is lost', () => {
    const simulateAtLeastOnce = simulation('simulateAtLeastOnce');

    expect(simulateAtLeastOnce({ acknowledgementLost: true })).toEqual({
      deliveryAttempts: 2,
      handlerInvocations: 2,
      effectApplications: 2,
    });
  });

  it('applies an idempotent effect once after an at-least-once redelivery', () => {
    const simulateIdempotentEffects = simulation('simulateIdempotentEffects');

    expect(simulateIdempotentEffects({ acknowledgementLost: true })).toEqual({
      deliveryAttempts: 2,
      handlerInvocations: 1,
      effectApplications: 1,
      duplicatesSkipped: 1,
    });
  });
});
