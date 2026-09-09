import { describe, expect, it } from '@jest/globals';

import * as queue from '../../src/index.js';

function simulation(name) {
  expect(queue[name]).toEqual(expect.any(Function));
  return queue[name];
}

describe('messaging semantics simulations', () => {
  it('loses an at-most-once message without retrying it', async () => {
    const simulateAtMostOnce = simulation('simulateAtMostOnce');

    await expect(simulateAtMostOnce({ messageLost: true })).resolves.toEqual({
      deliveryAttempts: 1,
      handlerInvocations: 0,
      effectApplications: 0,
      trace: ['delivery-attempted', 'message-lost'],
    });
  });

  it('repeats an at-least-once effect when acknowledgement is lost', async () => {
    const simulateAtLeastOnce = simulation('simulateAtLeastOnce');

    await expect(simulateAtLeastOnce({ acknowledgementLost: true })).resolves.toEqual({
      deliveryAttempts: 2,
      handlerInvocations: 2,
      effectApplications: 2,
      trace: [
        'delivery-attempted',
        'handler-invoked',
        'effect-applied',
        'acknowledgement-lost',
        'delivery-attempted',
        'handler-invoked',
        'effect-applied',
        'acknowledged',
      ],
    });
  });

  it('applies an idempotent effect once after an at-least-once redelivery', async () => {
    const simulateIdempotentEffects = simulation('simulateIdempotentEffects');

    await expect(simulateIdempotentEffects({ acknowledgementLost: true })).resolves.toEqual({
      deliveryAttempts: 2,
      handlerInvocations: 2,
      effectApplications: 1,
      duplicatesSkipped: 1,
      trace: [
        'delivery-attempted',
        'handler-invoked',
        'effect-applied',
        'acknowledgement-lost',
        'delivery-attempted',
        'handler-invoked',
        'duplicate-skipped',
        'acknowledged',
      ],
    });
  });
});
