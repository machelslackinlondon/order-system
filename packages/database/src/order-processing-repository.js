import { mapOrderProcessing } from './mappers.js';
import { runQuery } from './query.js';

export function createOrderProcessingRepository(queryable) {
  return {
    async create({ orderId, status = 'PENDING' }) {
      const result = await runQuery(
        queryable,
        `
          INSERT INTO order_processing (order_id, status)
          VALUES ($1, $2)
          RETURNING order_id, status, created_at, updated_at
        `,
        [orderId, status],
      );

      return mapOrderProcessing(result.rows[0]);
    },

    async findByOrderId(orderId) {
      const result = await runQuery(
        queryable,
        `
          SELECT order_id, status, created_at, updated_at
          FROM order_processing
          WHERE order_id = $1
        `,
        [orderId],
      );

      return result.rowCount === 0 ? null : mapOrderProcessing(result.rows[0]);
    },
  };
}
