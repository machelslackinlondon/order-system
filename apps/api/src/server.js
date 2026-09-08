import { randomUUID } from 'node:crypto';
import {
  createOrderRepository,
  createPool,
  createProductRepository,
} from '@distributed-order-system/database';

import { buildApp } from './app.js';
import { createOrderService } from './create-order.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://orders:orders_dev@127.0.0.1:5432/orders';
const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.API_PORT ?? '3000', 10);

const pool = createPool({ connectionString });
const orderService = createOrderService({
  productRepository: createProductRepository(pool),
  orderRepository: createOrderRepository(pool),
  idGenerator: randomUUID,
});
const app = buildApp({ orderService, logger: true });

pool.on('error', (error) => {
  app.log.error({ err: error }, 'Unexpected idle database client error');
});

app.addHook('onClose', async () => {
  await pool.end();
});

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
