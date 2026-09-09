function validateWorkerIds(workerIds) {
  if (
    !Array.isArray(workerIds) ||
    workerIds.length < 2 ||
    workerIds.some((workerId) => typeof workerId !== 'string' || workerId.length === 0) ||
    new Set(workerIds).size !== workerIds.length
  ) {
    throw new TypeError('Leader election requires at least two distinct non-empty worker IDs');
  }
}

export function createLeaderElectionSimulation({ workerIds, heartbeatTimeoutMs, now } = {}) {
  validateWorkerIds(workerIds);

  if (!Number.isInteger(heartbeatTimeoutMs) || heartbeatTimeoutMs <= 0) {
    throw new RangeError('Heartbeat timeout must be a positive integer');
  }

  if (typeof now !== 'function') {
    throw new TypeError('Leader election clock must be a function');
  }

  const configuredWorkers = [...workerIds];
  const knownWorkers = new Set(configuredWorkers);
  const failedWorkers = new Set();
  let leaderId = null;
  let lastHeartbeatAt = null;

  function electLeaderAt(timestamp) {
    if (leaderId !== null) {
      return leaderId;
    }

    leaderId = configuredWorkers.find((workerId) => !failedWorkers.has(workerId)) ?? null;
    lastHeartbeatAt = leaderId === null ? null : timestamp;

    return leaderId;
  }

  function electLeader() {
    return leaderId === null ? electLeaderAt(now()) : leaderId;
  }

  function replaceExpiredLeader(timestamp) {
    failedWorkers.add(leaderId);
    leaderId = null;
    lastHeartbeatAt = null;

    return electLeaderAt(timestamp);
  }

  return {
    electLeader,

    getLeader() {
      return leaderId;
    },

    heartbeat(workerId) {
      if (!knownWorkers.has(workerId)) {
        throw new RangeError(`Unknown worker ID: ${String(workerId)}`);
      }

      const timestamp = now();

      if (leaderId !== null && timestamp - lastHeartbeatAt >= heartbeatTimeoutMs) {
        replaceExpiredLeader(timestamp);
      }

      if (workerId !== leaderId) {
        throw new Error('Only the current leader can send a heartbeat');
      }

      lastHeartbeatAt = timestamp;
    },

    checkLeader() {
      if (leaderId === null) {
        return electLeader();
      }

      if (now() - lastHeartbeatAt < heartbeatTimeoutMs) {
        return leaderId;
      }

      return replaceExpiredLeader(now());
    },
  };
}
