const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;

function validatePartitionIds(partitionIds) {
  if (
    !Array.isArray(partitionIds) ||
    partitionIds.length < 2 ||
    partitionIds.some(
      (partitionId) => typeof partitionId !== 'string' || partitionId.length === 0,
    ) ||
    new Set(partitionIds).size !== partitionIds.length
  ) {
    throw new TypeError('Partition router requires at least two distinct non-empty partition IDs');
  }
}

function hash(value) {
  let result = FNV_OFFSET_BASIS;

  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), FNV_PRIME) >>> 0;
  }

  return result;
}

export function createOrderPartitionRouter({ partitionIds } = {}) {
  validatePartitionIds(partitionIds);

  const configuredPartitions = [...partitionIds];

  return {
    route(order) {
      if (
        !order ||
        typeof order !== 'object' ||
        Array.isArray(order) ||
        typeof order.customerId !== 'string' ||
        order.customerId.length === 0
      ) {
        throw new TypeError('Order must have a non-empty string customer ID');
      }

      return configuredPartitions[hash(order.customerId) % configuredPartitions.length];
    },
  };
}
