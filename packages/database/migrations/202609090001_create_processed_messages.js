export function up(pgm) {
  pgm.sql(`
    CREATE TABLE processed_messages (
      message_id text PRIMARY KEY,
      processed_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export function down(pgm) {
  pgm.sql('DROP TABLE processed_messages;');
}
