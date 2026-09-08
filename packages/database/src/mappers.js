export function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    stock: row.stock,
    version: row.version,
  };
}

export function mapOrder(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    quantity: row.quantity,
    amount: row.amount,
    status: row.status,
    version: row.version,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
