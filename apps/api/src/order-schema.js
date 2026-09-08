const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
};

const orderSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'customerId',
    'productId',
    'quantity',
    'amount',
    'status',
    'version',
    'idempotencyKey',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    customerId: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    quantity: { type: 'integer', minimum: 1 },
    amount: { type: 'integer', minimum: 1 },
    status: { type: 'string', const: 'PENDING' },
    version: { type: 'integer', const: 1 },
    idempotencyKey: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const createOrderSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['customerId', 'productId', 'quantity', 'amount'],
    properties: {
      customerId: { type: 'string', format: 'uuid' },
      productId: { type: 'string', format: 'uuid' },
      quantity: { type: 'integer', minimum: 1, maximum: 2147483647 },
      amount: { type: 'integer', minimum: 1, maximum: 2147483647 },
    },
  },
  headers: {
    type: 'object',
    required: ['idempotency-key'],
    properties: {
      'idempotency-key': { type: 'string', minLength: 1 },
    },
  },
  response: {
    201: orderSchema,
    400: errorSchema,
    404: errorSchema,
    409: errorSchema,
    500: errorSchema,
    503: errorSchema,
  },
};
