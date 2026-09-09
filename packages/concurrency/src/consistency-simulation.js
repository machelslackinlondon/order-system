function copy(record) {
  return record ? structuredClone(record) : null;
}

function validateOrder(order) {
  if (
    !order ||
    typeof order !== 'object' ||
    Array.isArray(order) ||
    typeof order.id !== 'string' ||
    order.id.length === 0
  ) {
    throw new TypeError('Order must have a non-empty string ID');
  }
}

function validateSessionToken(token) {
  if (
    !token ||
    typeof token !== 'object' ||
    Array.isArray(token) ||
    typeof token.orderId !== 'string' ||
    token.orderId.length === 0 ||
    !Number.isInteger(token.minimumVersion) ||
    token.minimumVersion < 0
  ) {
    throw new TypeError(
      'Session token must contain an order ID and non-negative integer minimum version',
    );
  }
}

export function createOrderConsistencySimulation() {
  const source = new Map();
  const readModel = new Map();
  const pendingUpdates = [];

  return {
    writeOrder(order) {
      validateOrder(order);

      const version = (source.get(order.id)?.version ?? 0) + 1;
      const record = structuredClone({ ...order, version });

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

    readForSession(token) {
      validateSessionToken(token);

      const { orderId, minimumVersion } = token;
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
