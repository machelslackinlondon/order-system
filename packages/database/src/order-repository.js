import { mapOrder } from './mappers.js';
import { runQuery } from './query.js';

const orderColumns = `
  id,
  customer_id,
  product_id,
  quantity,
  amount,
  status,
  version,
  idempotency_key,
  created_at,
  updated_at
`;

function mapIdempotencyRecord(row, created = false) {
  return {
    created,
    order: mapOrder(row),
    requestFingerprint: row.request_fingerprint,
  };
}

export function createOrderRepository(queryable) {
  async function findByIdempotencyKey(idempotencyKey) {
    const result = await runQuery(
      queryable,
      `
        SELECT ${orderColumns}, request_fingerprint
        FROM orders
        WHERE idempotency_key = $1
      `,
      [idempotencyKey],
    );

    return result.rowCount === 0 ? null : mapIdempotencyRecord(result.rows[0]);
  }

  return {
    async create(order) {
      const result = await runQuery(
        queryable,
        `
          INSERT INTO orders (
            id,
            customer_id,
            product_id,
            quantity,
            amount,
            status,
            version,
            idempotency_key
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING ${orderColumns}
        `,
        [
          order.id,
          order.customerId,
          order.productId,
          order.quantity,
          order.amount,
          order.status,
          order.version,
          order.idempotencyKey,
        ],
      );

      return mapOrder(result.rows[0]);
    },

    async createIdempotent(order) {
      const result = await runQuery(
        queryable,
        `
          INSERT INTO orders (
            id,
            customer_id,
            product_id,
            quantity,
            amount,
            status,
            version,
            idempotency_key,
            request_fingerprint
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING ${orderColumns}, request_fingerprint
        `,
        [
          order.id,
          order.customerId,
          order.productId,
          order.quantity,
          order.amount,
          order.status,
          order.version,
          order.idempotencyKey,
          order.requestFingerprint,
        ],
      );

      if (result.rowCount === 1) {
        return mapIdempotencyRecord(result.rows[0], true);
      }

      return findByIdempotencyKey(order.idempotencyKey);
    },

    findByIdempotencyKey,
  };
}
