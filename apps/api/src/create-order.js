import { createHash } from 'node:crypto';

import {
  IdempotencyKeyReusedError,
  InsufficientInventoryError,
  OrderValidationError,
  ProductNotFoundError,
} from './order-errors.js';

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

function fingerprintOrderRequest(input) {
  const canonicalRequest = JSON.stringify([
    input.customerId,
    input.productId,
    input.quantity,
    input.amount,
  ]);

  return createHash('sha256').update(canonicalRequest).digest('hex');
}

function replayOrder(record, requestFingerprint) {
  if (record.requestFingerprint !== requestFingerprint) {
    throw new IdempotencyKeyReusedError();
  }

  return record.order;
}

export function createOrderService({ productRepository, orderRepository, idGenerator }) {
  return {
    async createOrder(input) {
      validateOrderInput(input);
      const requestFingerprint = fingerprintOrderRequest(input);
      const existing = await orderRepository.findByIdempotencyKey(input.idempotencyKey);

      if (existing) {
        return replayOrder(existing, requestFingerprint);
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

      return result.created ? result.order : replayOrder(result, requestFingerprint);
    },
  };
}
