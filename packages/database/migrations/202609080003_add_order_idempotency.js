export function up(pgm) {
  pgm.sql(`
    ALTER TABLE orders
      ADD COLUMN request_fingerprint text,
      ADD CONSTRAINT orders_request_fingerprint_sha256
        CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$'),
      ADD CONSTRAINT orders_idempotency_key_unique UNIQUE (idempotency_key);
  `);
}

export function down(pgm) {
  pgm.sql(`
    ALTER TABLE orders
      DROP CONSTRAINT orders_idempotency_key_unique,
      DROP CONSTRAINT orders_request_fingerprint_sha256,
      DROP COLUMN request_fingerprint;
  `);
}
