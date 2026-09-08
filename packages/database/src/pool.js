import { Pool } from 'pg';

export function createPool({ connectionString, max = 10 }) {
  if (!connectionString) {
    throw new TypeError('connectionString is required');
  }

  return new Pool({ connectionString, max });
}
