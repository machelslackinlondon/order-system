export function up(pgm) {
  pgm.sql(`
    CREATE TABLE order_processing (
      order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'PENDING'
        CONSTRAINT order_processing_status_valid
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export function down(pgm) {
  pgm.sql('DROP TABLE order_processing;');
}
