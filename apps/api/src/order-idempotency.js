import { createHash } from 'node:crypto';

import { IdempotencyKeyReusedError } from './order-errors.js';

export function fingerprintOrderRequest(input) {
  const canonicalRequest = JSON.stringify([
    input.customerId,
    input.productId,
    input.quantity,
    input.amount,
  ]);

  return createHash('sha256').update(canonicalRequest).digest('hex');
}

export function resolveIdempotentOrder(record, requestFingerprint) {
  const storedFingerprint = record.requestFingerprint ?? fingerprintOrderRequest(record.order);

  if (storedFingerprint !== requestFingerprint) {
    throw new IdempotencyKeyReusedError();
  }

  return record.order;
}
