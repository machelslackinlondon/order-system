import { describe, expect, it, jest } from '@jest/globals';
import { createOrderService } from '../../src/create-order.js';

const productId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const createdAt = new Date('2026-09-08T12:00:00.000Z');
const validInput = {
  customerId,
  productId,
  quantity: 2,
  amount: 2500,
  idempotencyKey: 'checkout-123',
};

function buildService({
  product = { id: productId, name: 'Keyboard', stock: 4 },
  createResult = {
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
  },
  findById = jest.fn(),
  create = jest.fn(),
  idGenerator = jest.fn(() => orderId),
} = {}) {
  findById.mockResolvedValue(product);
  create.mockResolvedValue(createResult);

  return {
    service: createOrderService({
      productRepository: { findById },
      orderRepository: { create },
      idGenerator,
    }),
    findById,
    create,
    idGenerator,
    createResult,
  };
}

describe('createOrderService', () => {
  it('creates a PENDING order when current stock is sufficient', async () => {
    const { service, findById, create, createResult } = buildService();

    await expect(service.createOrder(validInput)).resolves.toEqual(createResult);
    expect(findById).toHaveBeenCalledWith(productId);
    expect(create).toHaveBeenCalledWith({
      id: orderId,
      customerId,
      productId,
      quantity: 2,
      amount: 2500,
      status: 'PENDING',
      idempotencyKey: 'checkout-123',
      version: 1,
    });
  });

  it.each([
    ['quantity', { ...validInput, quantity: 0 }],
    ['amount', { ...validInput, amount: 1.5 }],
    ['idempotency key', { ...validInput, idempotencyKey: '' }],
  ])('rejects an invalid %s before querying the database', async (_label, input) => {
    const { service, findById, create } = buildService();

    await expect(service.createOrder(input)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    expect(findById).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an unknown product', async () => {
    const { service, create } = buildService({ product: null });

    await expect(service.createOrder(validInput)).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
      statusCode: 404,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a quantity greater than current stock', async () => {
    const { service, create } = buildService({
      product: { id: productId, name: 'Keyboard', stock: 1 },
    });

    await expect(service.createOrder(validInput)).rejects.toMatchObject({
      code: 'INSUFFICIENT_INVENTORY',
      statusCode: 409,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('propagates database availability errors unchanged', async () => {
    const databaseError = Object.assign(new Error('connection failed'), {
      code: 'DATABASE_UNAVAILABLE',
    });
    const { service, findById } = buildService();
    findById.mockRejectedValue(databaseError);

    await expect(service.createOrder(validInput)).rejects.toBe(databaseError);
  });
});
