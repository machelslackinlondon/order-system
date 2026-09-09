function copy(record) {
  return record ? { ...record } : null;
}

export function createOrderConsistencySimulation() {
  const source = new Map();
  const readModel = new Map();
  const pendingUpdates = [];

  return {
    writeOrder(order) {
      const version = (source.get(order.id)?.version ?? 0) + 1;
      const record = { ...order, version };

      source.set(order.id, record);
      pendingUpdates.push(record);

      return {
        order: copy(record),
        token: { orderId: order.id, minimumVersion: version },
      };
    },

    readSource(orderId) {
      return copy(source.get(orderId));
    },

    readModel(orderId) {
      return copy(readModel.get(orderId));
    },

    readForSession({ orderId, minimumVersion }) {
      const projected = readModel.get(orderId);

      if (projected && projected.version >= minimumVersion) {
        return copy(projected);
      }

      const authoritative = source.get(orderId);
      return authoritative?.version >= minimumVersion ? copy(authoritative) : null;
    },

    applyNextReadModelUpdate() {
      const update = pendingUpdates.shift();

      if (!update) {
        return null;
      }

      readModel.set(update.id, update);
      return copy(update);
    },
  };
}
