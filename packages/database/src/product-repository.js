import { mapProduct } from './mappers.js';
import { runQuery } from './query.js';

export function createProductRepository(queryable) {
  return {
    async create({ id, name, stock, version = 1 }) {
      const result = await runQuery(
        queryable,
        `
          INSERT INTO products (id, name, stock, version)
          VALUES ($1, $2, $3, $4)
          RETURNING id, name, stock, version
        `,
        [id, name, stock, version],
      );

      return mapProduct(result.rows[0]);
    },

    async findById(id) {
      const result = await runQuery(
        queryable,
        'SELECT id, name, stock, version FROM products WHERE id = $1',
        [id],
      );

      return result.rowCount === 0 ? null : mapProduct(result.rows[0]);
    },

    async reserveWithVersion({ productId, quantity, expectedVersion }) {
      const result = await runQuery(
        queryable,
        `
          UPDATE products
          SET stock = stock - $2,
              version = version + 1
          WHERE id = $1
            AND stock >= $2
            AND version = $3
          RETURNING id, name, stock, version
        `,
        [productId, quantity, expectedVersion],
      );

      return result.rowCount === 0 ? null : mapProduct(result.rows[0]);
    },
  };
}
