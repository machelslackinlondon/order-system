export function simulateAtMostOnce({ messageLost = false } = {}) {
  const processingCount = messageLost ? 0 : 1;

  return {
    deliveryAttempts: 1,
    handlerInvocations: processingCount,
    effectApplications: processingCount,
  };
}

export function simulateAtLeastOnce({ acknowledgementLost = false } = {}) {
  const deliveryAttempts = acknowledgementLost ? 2 : 1;

  return {
    deliveryAttempts,
    handlerInvocations: deliveryAttempts,
    effectApplications: deliveryAttempts,
  };
}

export function simulateIdempotentEffects({ acknowledgementLost = false } = {}) {
  const deliveryAttempts = acknowledgementLost ? 2 : 1;

  return {
    deliveryAttempts,
    handlerInvocations: 1,
    effectApplications: 1,
    duplicatesSkipped: deliveryAttempts - 1,
  };
}
