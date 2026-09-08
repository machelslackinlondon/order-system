const NODE_CONNECTION_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
]);

export class DatabaseUnavailableError extends Error {
  constructor({ cause } = {}) {
    super('Database unavailable', { cause });
    this.name = 'DatabaseUnavailableError';
    this.code = 'DATABASE_UNAVAILABLE';
  }
}

export function isDatabaseUnavailable(error) {
  return (
    NODE_CONNECTION_CODES.has(error?.code) ||
    (typeof error?.code === 'string' && error.code.startsWith('08')) ||
    ['57P01', '57P02', '57P03'].includes(error?.code)
  );
}
