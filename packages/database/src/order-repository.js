import { mapOrder } from './mappers.js';
import { runQuery } from './query.js';

export function createOrderRepository(queryable) {
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
          RETURNING
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
  };
}
