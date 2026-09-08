import {
  createOrderProcessingRepository,
  createOrderRepository,
  createProductRepository,
  withTransaction,
} from '@order-system/database';

import { validateOrderInput } from './create-order.js';
import { InsufficientInventoryError, ProductNotFoundError } from './order-errors.js';

export function createAtomicOrderService({ pool, idGenerator }) {
  return {
    async createOrder(input) {
      validateOrderInput(input);

      return withTransaction(pool, async (client) => {
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

        const order = await orders.create({
          id: idGenerator(),
          customerId: input.customerId,
          productId: input.productId,
          quantity: input.quantity,
          amount: input.amount,
          status: 'PENDING',
          idempotencyKey: input.idempotencyKey,
          version: 1,
        });

        await processing.create({ orderId: order.id });

        return order;
      });
    },
  };
}
