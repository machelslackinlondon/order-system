function copy(record) {
  return record ? structuredClone(record) : null;
}

function validateReplicaIds(replicaIds) {
  if (
    !Array.isArray(replicaIds) ||
    replicaIds.length !== 2 ||
    replicaIds.some((replicaId) => typeof replicaId !== 'string' || replicaId.length === 0) ||
    new Set(replicaIds).size !== 2
  ) {
    throw new TypeError('Replication simulation requires two distinct non-empty replica IDs');
  }
}

function validateOrder(order) {
  if (
    !order ||
    typeof order !== 'object' ||
    Array.isArray(order) ||
    typeof order.id !== 'string' ||
    order.id.length === 0
  ) {
    throw new TypeError('Replicated order must have a non-empty string ID');
  }
}

export function createOrderReplicationSimulation({ replicaIds } = {}) {
  validateReplicaIds(replicaIds);

  const primary = new Map();
  const replicaState = new Map(replicaIds.map((replicaId) => [replicaId, new Map()]));
  const pendingReplication = new Map(replicaIds.map((replicaId) => [replicaId, []]));

  function stateFor(replicaId) {
    const state = replicaState.get(replicaId);

    if (!state) {
      throw new RangeError(`Unknown replica ID: ${String(replicaId)}`);
    }

    return state;
  }

  return {
    writePrimary(order) {
      validateOrder(order);

      const version = (primary.get(order.id)?.version ?? 0) + 1;
      const record = structuredClone({ ...order, version });

      primary.set(order.id, record);
      for (const replicaId of replicaIds) {
        pendingReplication.get(replicaId).push(record);
      }

      return copy(record);
    },

    readPrimary(orderId) {
      return copy(primary.get(orderId));
    },

    readReplica(replicaId, orderId) {
      return copy(stateFor(replicaId).get(orderId));
    },

    replicateNext(replicaId) {
      const state = stateFor(replicaId);
      const update = pendingReplication.get(replicaId).shift();

      if (!update) {
        return null;
      }

      state.set(update.id, update);
      return copy(update);
    },
  };
}
