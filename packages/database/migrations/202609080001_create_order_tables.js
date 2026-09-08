export function up(pgm) {
  pgm.sql(`
    CREATE TABLE products (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      stock integer NOT NULL CONSTRAINT products_stock_nonnegative CHECK (stock >= 0),
      version integer NOT NULL DEFAULT 1 CONSTRAINT products_version_positive CHECK (version >= 1)
    );

    CREATE TABLE orders (
      id uuid PRIMARY KEY,
      customer_id uuid NOT NULL,
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity integer NOT NULL CONSTRAINT orders_quantity_positive CHECK (quantity > 0),
      amount integer NOT NULL CONSTRAINT orders_amount_positive CHECK (amount > 0),
      status text NOT NULL DEFAULT 'PENDING'
        CONSTRAINT orders_status_valid CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
      version integer NOT NULL DEFAULT 1 CONSTRAINT orders_version_positive CHECK (version >= 1),
      idempotency_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export function down(pgm) {
  pgm.sql(`
    DROP TABLE orders;
    DROP TABLE products;
  `);
}
