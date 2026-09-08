/**
 * Deliberately unsafe read-then-write reservation for the race-condition
 * experiment. Do not use this implementation in the order-processing path.
 */
export async function reserveInventoryUnsafe(inventory, productId, quantity) {
  const stock = await inventory.getStock(productId);

  if (stock < quantity) {
    return false;
  }

  await inventory.updateStock(productId, stock - quantity);

  return true;
}
