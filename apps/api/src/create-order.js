import {
  InsufficientInventoryError,
  OrderValidationError,
  ProductNotFoundError,
} from './order-errors.js';

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validateInput(input) {
  if (
    !input ||
    typeof input.customerId !== 'string' ||
    typeof input.productId !== 'string' ||
    !isPositiveInteger(input.quantity) ||
    !isPositiveInteger(input.amount) ||
    typeof input.idempotencyKey !== 'string' ||
    input.idempotencyKey.trim() === ''
  ) {
    throw new OrderValidationError();
  }
}

export function createOrderService({ productRepository, orderRepository, idGenerator }) {
  return {
    async createOrder(input) {
      validateInput(input);

      const product = await productRepository.findById(input.productId);

      if (!product) {
        throw new ProductNotFoundError();
      }

      if (product.stock < input.quantity) {
        throw new InsufficientInventoryError();
      }

      return orderRepository.create({
        id: idGenerator(),
        customerId: input.customerId,
        productId: input.productId,
        quantity: input.quantity,
        amount: input.amount,
        status: 'PENDING',
        idempotencyKey: input.idempotencyKey,
        version: 1,
      });
    },
  };
}
