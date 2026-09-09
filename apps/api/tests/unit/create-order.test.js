import { describe, expect, it, jest } from '@jest/globals';
import { createOrderService } from '../../src/create-order.js';

const productId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const createdAt = new Date('2026-09-08T12:00:00.000Z');
const requestFingerprint = '6b9a63cb6ae511645d84d4ef170bc6bdd4b78f763d9ab3dcf82453599636c1a9';
const validInput = {
  customerId,
  productId,
  quantity: 2,
  amount: 2500,
  idempotencyKey: 'checkout-123',
};
const persistedOrder = {
  id: orderId,
  customerId,
  productId,
  quantity: 2,
  amount: 2500,
  status: 'PENDING',
  idempotencyKey: 'checkout-123',
  version: 1,
  createdAt,
  updatedAt: createdAt,
};

function buildService({
  product = { id: productId, name: 'Keyboard', stock: 4 },
  createResult = persistedOrder,
  existing = null,
  findById = jest.fn(),
  findByIdempotencyKey = jest.fn(),
  createIdempotent = jest.fn(),
  createIdempotentResult = { created: true, order: createResult },
  idGenerator = jest.fn(() => orderId),
  publishedOrders = [],
} = {}) {
  findById.mockResolvedValue(product);
  findByIdempotencyKey.mockResolvedValue(existing);
  createIdempotent.mockResolvedValue(createIdempotentResult);

  return {
    service: createOrderService({
      productRepository: { findById },
      orderRepository: { findByIdempotencyKey, createIdempotent },
      idGenerator,
      orderCreatedPublisher: {
        async publish(order) {
          publishedOrders.push(order);
        },
      },
    }),
    findById,
    findByIdempotencyKey,
    createIdempotent,
    idGenerator,
    createResult,
    publishedOrders,
  };
}

describe('createOrderService', () => {
  it('creates a PENDING order when current stock is sufficient', async () => {
    const { service, findById, createIdempotent, createResult, publishedOrders } = buildService();

    await expect(service.createOrder(validInput)).resolves.toEqual(createResult);
    expect(findById).toHaveBeenCalledWith(productId);
    expect(createIdempotent).toHaveBeenCalledWith({
      id: orderId,
      customerId,
      productId,
      quantity: 2,
      amount: 2500,
      status: 'PENDING',
      idempotencyKey: 'checkout-123',
      requestFingerprint,
      version: 1,
    });
    expect(publishedOrders).toEqual([createResult]);
  });

  it.each([
    ['quantity', { ...validInput, quantity: 0 }],
    ['amount', { ...validInput, amount: 1.5 }],
    ['idempotency key', { ...validInput, idempotencyKey: '' }],
  ])('rejects an invalid %s before querying the database', async (_label, input) => {
    const { service, findById, findByIdempotencyKey, createIdempotent } = buildService();

    await expect(service.createOrder(input)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    expect(findByIdempotencyKey).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
    expect(createIdempotent).not.toHaveBeenCalled();
  });

  it('rejects an unknown product', async () => {
    const { service, createIdempotent } = buildService({ product: null });

    await expect(service.createOrder(validInput)).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
      statusCode: 404,
    });
    expect(createIdempotent).not.toHaveBeenCalled();
  });

  it('rejects a quantity greater than current stock', async () => {
    const { service, createIdempotent } = buildService({
      product: { id: productId, name: 'Keyboard', stock: 1 },
    });

    await expect(service.createOrder(validInput)).rejects.toMatchObject({
      code: 'INSUFFICIENT_INVENTORY',
      statusCode: 409,
    });
    expect(createIdempotent).not.toHaveBeenCalled();
  });

  it('returns the original order for a retry without revalidating current stock', async () => {
    const { service, findById, createIdempotent, idGenerator, publishedOrders } = buildService({
      existing: { order: persistedOrder, requestFingerprint },
      product: null,
    });

    await expect(service.createOrder(validInput)).resolves.toEqual(persistedOrder);
    expect(findById).not.toHaveBeenCalled();
    expect(createIdempotent).not.toHaveBeenCalled();
    expect(idGenerator).not.toHaveBeenCalled();
    expect(publishedOrders).toEqual([]);
  });

  it('does not publish when a concurrent request loses the idempotent insert', async () => {
    const { service, publishedOrders } = buildService({
      createIdempotentResult: {
        created: false,
        order: persistedOrder,
        requestFingerprint,
      },
    });

    await expect(service.createOrder(validInput)).resolves.toEqual(persistedOrder);
    expect(publishedOrders).toEqual([]);
  });

  it('rejects a reused key with a different request fingerprint', async () => {
    const { service, findById, createIdempotent } = buildService({
      existing: { order: null, requestFingerprint: 'different-request' },
    });

    await expect(service.createOrder(validInput)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      statusCode: 409,
    });
    expect(findById).not.toHaveBeenCalled();
    expect(createIdempotent).not.toHaveBeenCalled();
  });

  it('propagates database availability errors unchanged', async () => {
    const databaseError = Object.assign(new Error('connection failed'), {
      code: 'DATABASE_UNAVAILABLE',
    });
    const { service, findById } = buildService();
    findById.mockRejectedValue(databaseError);

    await expect(service.createOrder(validInput)).rejects.toBe(databaseError);
  });

  it('propagates event publication failure after the order is inserted', async () => {
    const publicationError = Object.assign(new Error('queue unavailable'), {
      code: 'QUEUE_SHUTDOWN',
    });
    let orderInserted = false;
    const service = createOrderService({
      productRepository: {
        async findById() {
          return { id: productId, name: 'Keyboard', stock: 4 };
        },
      },
      orderRepository: {
        async findByIdempotencyKey() {
          return null;
        },
        async createIdempotent() {
          orderInserted = true;
          return { created: true, order: persistedOrder };
        },
      },
      idGenerator: () => orderId,
      orderCreatedPublisher: {
        async publish() {
          if (!orderInserted) {
            throw new Error('event published before order insertion');
          }
          throw publicationError;
        },
      },
    });

    await expect(service.createOrder(validInput)).rejects.toBe(publicationError);
    expect(orderInserted).toBe(true);
  });
});
