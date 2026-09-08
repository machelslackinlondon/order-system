import {
  createOrderProcessingRepository,
  createOrderRepository,
  createProductRepository,
  withTransaction,
} from '@order-system/database';

import { validateOrderInput } from './create-order.js';
import { InsufficientInventoryError, ProductNotFoundError } from './order-errors.js';
import { fingerprintOrderRequest, resolveIdempotentOrder } from './order-idempotency.js';

class IdempotentReplay extends Error {
  constructor(order) {
    super('Replay committed order after rolling back duplicate work');
    this.order = order;
  }
}

export function createAtomicOrderService({ pool, idGenerator }) {
  return {
    async createOrder(input) {
      validateOrderInput(input);
      const requestFingerprint = fingerprintOrderRequest(input);
      const existing = await createOrderRepository(pool).findByIdempotencyKey(input.idempotencyKey);

      if (existing) {
        return resolveIdempotentOrder(existing, requestFingerprint);
      }

      try {
        return await withTransaction(pool, async (client) => {
          const products = createProductRepository(client);
          const orders = createOrderRepository(client);
          const processing = createOrderProcessingRepository(client);
          const product = await products.findByIdForUpdate(input.productId);

          if (!product) {
            throw new ProductNotFoundError();
          }

          if (product.stock < input.quantity) {
            throw new InsufficientInventoryError();
          }

          const reservedProduct = await products.reserveLocked({
            productId: input.productId,
            quantity: input.quantity,
          });

          if (!reservedProduct) {
            throw new InsufficientInventoryError();
          }

          const result = await orders.createIdempotent({
            id: idGenerator(),
            customerId: input.customerId,
            productId: input.productId,
            quantity: input.quantity,
            amount: input.amount,
            status: 'PENDING',
            idempotencyKey: input.idempotencyKey,
            requestFingerprint,
            version: 1,
          });

          if (!result.created) {
            throw new IdempotentReplay(resolveIdempotentOrder(result, requestFingerprint));
          }

          await processing.create({ orderId: result.order.id });

          return result.order;
        });
      } catch (error) {
        if (error instanceof IdempotentReplay) {
          return error.order;
        }

        throw error;
      }
    },
  };
}
