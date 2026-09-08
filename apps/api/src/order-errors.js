export class OrderApplicationError extends Error {
  constructor(message, { code, statusCode }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class OrderValidationError extends OrderApplicationError {
  constructor() {
    super('Invalid order request', {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  }
}

export class ProductNotFoundError extends OrderApplicationError {
  constructor() {
    super('Product not found', {
      code: 'PRODUCT_NOT_FOUND',
      statusCode: 404,
    });
  }
}

export class InsufficientInventoryError extends OrderApplicationError {
  constructor() {
    super('Insufficient inventory', {
      code: 'INSUFFICIENT_INVENTORY',
      statusCode: 409,
    });
  }
}
