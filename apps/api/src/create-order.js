import {
  InsufficientInventoryError,
  OrderValidationError,
  ProductNotFoundError,
} from './order-errors.js';
import { fingerprintOrderRequest, resolveIdempotentOrder } from './order-idempotency.js';

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export function validateOrderInput(input) {
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
      validateOrderInput(input);
      const requestFingerprint = fingerprintOrderRequest(input);
      const existing = await orderRepository.findByIdempotencyKey(input.idempotencyKey);

      if (existing) {
        return resolveIdempotentOrder(existing, requestFingerprint);
      }

      const product = await productRepository.findById(input.productId);

      if (!product) {
        throw new ProductNotFoundError();
      }

      if (product.stock < input.quantity) {
        throw new InsufficientInventoryError();
      }

      const result = await orderRepository.createIdempotent({
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

      return result.created ? result.order : resolveIdempotentOrder(result, requestFingerprint);
    },
  };
}
