import { DatabaseUnavailableError, isDatabaseUnavailable } from './errors.js';

function translateAvailabilityError(error) {
  if (error instanceof DatabaseUnavailableError) {
    return error;
  }

  return isDatabaseUnavailable(error) ? new DatabaseUnavailableError({ cause: error }) : error;
}

function connectionFailure(error) {
  if (error instanceof DatabaseUnavailableError) {
    return error.cause ?? error;
  }

  return isDatabaseUnavailable(error) ? error : undefined;
}

export async function withTransaction(pool, operation) {
  let client;

  try {
    client = await pool.connect();
  } catch (error) {
    throw translateAvailabilityError(error);
  }

  let discardError;

  try {
    try {
      await client.query('BEGIN');
    } catch (error) {
      discardError = connectionFailure(error);
      throw translateAvailabilityError(error);
    }

    try {
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (primaryError) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        discardError = rollbackError;
      }

      discardError ??= connectionFailure(primaryError);
      throw translateAvailabilityError(primaryError);
    }
  } finally {
    client.release(discardError);
  }
}
