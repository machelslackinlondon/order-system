import { createProductRepository, withTransaction } from '@order-system/database';

export { createOrderConsistencySimulation } from './consistency-simulation.js';
export { createLeaderElectionSimulation } from './leader-election-simulation.js';
export { createOrderReplicationSimulation } from './replication-simulation.js';
export { createOrderPartitionRouter } from './sharding-simulation.js';

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

export class InvalidInventoryQuantityError extends Error {
  constructor(quantity) {
    super('Inventory quantity must be a positive integer');
    this.name = 'InvalidInventoryQuantityError';
    this.code = 'INVALID_INVENTORY_QUANTITY';
    this.quantity = quantity;
  }
}

export class InventoryProductNotFoundError extends Error {
  constructor(productId) {
    super('Inventory product not found');
    this.name = 'InventoryProductNotFoundError';
    this.code = 'INVENTORY_PRODUCT_NOT_FOUND';
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
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError('maxRetries must be a non-negative integer');
  }

  return async function reserve({ productId, quantity }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InvalidInventoryQuantityError(quantity);
    }

    const maxAttempts = maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const product = await productRepository.findById(productId);

      if (!product) {
        throw new InventoryProductNotFoundError(productId);
      }

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

export function createPessimisticInventoryReservation({ pool }) {
  return async function reserve({ productId, quantity }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InvalidInventoryQuantityError(quantity);
    }

    return withTransaction(pool, async (client) => {
      const productRepository = createProductRepository(client);
      const product = await productRepository.findByIdForUpdate(productId);

      if (!product) {
        throw new InventoryProductNotFoundError(productId);
      }

      if (product.stock < quantity) {
        throw new InsufficientInventoryError(productId);
      }

      const reserved = await productRepository.reserveLocked({ productId, quantity });

      if (!reserved) {
        throw new InsufficientInventoryError(productId);
      }

      return reserved;
    });
  };
}

export function simulatePartitionedInventory({ policy, initialStock, reservations }) {
  if (policy !== 'CP' && policy !== 'AP') {
    throw new RangeError('Partition policy must be CP or AP');
  }
  if (!Number.isInteger(initialStock) || initialStock < 0) {
    throw new RangeError('Initial stock must be a non-negative integer');
  }
  if (!Array.isArray(reservations) || reservations.length !== 2) {
    throw new RangeError('Partition simulation requires exactly two reservations');
  }
  const replicas = reservations.map(({ replica }) => replica);
  if (
    replicas.some((replica) => typeof replica !== 'string' || replica.length === 0) ||
    new Set(replicas).size !== 2
  ) {
    throw new RangeError('Partition simulation requires two distinct replicas');
  }
  if (reservations.some(({ quantity }) => !Number.isInteger(quantity) || quantity <= 0)) {
    throw new RangeError('Reservation quantities must be positive integers');
  }

  const outcomes = reservations.map((reservation) => ({
    ...reservation,
    accepted: policy === 'AP' && reservation.quantity <= initialStock,
  }));
  const accepted = outcomes.filter(({ accepted }) => accepted);
  const rejected = outcomes.filter(({ accepted }) => !accepted);
  const totalAcceptedQuantity = accepted.reduce((total, { quantity }) => total + quantity, 0);

  return {
    policy,
    acceptedOrderIds: accepted.map(({ orderId }) => orderId),
    rejectedOrderIds: rejected.map(({ orderId }) => orderId),
    replicaStock: Object.fromEntries(
      outcomes.map(({ accepted, quantity, replica }) => [
        replica,
        accepted ? initialStock - quantity : initialStock,
      ]),
    ),
    totalAcceptedQuantity,
    availabilityPreserved: policy === 'AP',
    consistencyPreserved: totalAcceptedQuantity <= initialStock,
  };
}
