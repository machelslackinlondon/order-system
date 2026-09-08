import { DatabaseUnavailableError, isDatabaseUnavailable } from './errors.js';

export async function runQuery(queryable, text, values = []) {
  try {
    return await queryable.query(text, values);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      throw new DatabaseUnavailableError({ cause: error });
    }

    throw error;
  }
}
