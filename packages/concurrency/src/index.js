/**
 * Deliberately unsafe read-then-write reservation for the race-condition
 * experiment. Do not use this implementation in the order-processing path.
 */
export async function reserveInventoryUnsafe(inventory, productId, quantity) {
  const stock = await inventory.getStock(productId);

  if (stock < quantity) {
    return false;
  }

  await inventory.updateStock(productId, stock - quantity);

  return true;
}

export class InsufficientInventoryError extends Error {
  constructor(productId) {
    super('Insufficient inventory');
    this.name = 'InsufficientInventoryError';
    this.code = 'INSUFFICIENT_INVENTORY';
    this.productId = productId;
  }
}

export class OptimisticRetriesExhaustedError extends Error {
  constructor(productId, attempts) {
    super('Optimistic inventory retries exhausted');
    this.name = 'OptimisticRetriesExhaustedError';
    this.code = 'OPTIMISTIC_RETRIES_EXHAUSTED';
    this.productId = productId;
    this.attempts = attempts;
  }
}

export function createOptimisticInventoryReservation({ productRepository, maxRetries = 3 }) {
  return async function reserve({ productId, quantity }) {
    const maxAttempts = maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const product = await productRepository.findById(productId);

      if (product.stock < quantity) {
        throw new InsufficientInventoryError(productId);
      }

      const reserved = await productRepository.reserveWithVersion({
        productId,
        quantity,
        expectedVersion: product.version,
      });

      if (reserved) {
        return reserved;
      }
    }

    throw new OptimisticRetriesExhaustedError(productId, maxAttempts);
  };
}
