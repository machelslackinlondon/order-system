import { setTimeout as sleep } from 'node:timers/promises';

export class TransientError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransientError';
    this.code = 'TRANSIENT_ERROR';
  }
}

export class PermanentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentError';
    this.code = 'PERMANENT_ERROR';
  }
}

export class InvalidRetryOptionsError extends RangeError {
  constructor() {
    super('Maximum attempts must be a positive integer');
    this.name = 'InvalidRetryOptionsError';
    this.code = 'INVALID_RETRY_OPTIONS';
  }
}

export class MessageDeadLetteredError extends Error {
  constructor({ attempts, classification, cause }) {
    super(`Message processing failed after ${attempts} attempt${attempts === 1 ? '' : 's'}`, {
      cause,
    });
    this.name = 'MessageDeadLetteredError';
    this.code = 'MESSAGE_DEAD_LETTERED';
    this.attempts = attempts;
    this.classification = classification;
  }
}

function classifyError(error) {
  return error instanceof TransientError ? 'TRANSIENT' : 'PERMANENT';
}

function retryDelay({ attempt, baseDelayMs, jitterRatio, random }) {
  const exponentialDelay = baseDelayMs * 2 ** (attempt - 1);
  const jitterMultiplier = 1 - jitterRatio + 2 * jitterRatio * random();
  return Math.round(exponentialDelay * jitterMultiplier);
}

function serializeError(error) {
  return {
    name: error.name,
    message: error.message,
    ...(error.code ? { code: error.code } : {}),
  };
}

export async function executeWithRetry({
  message,
  operation,
  deadLetterQueue,
  maxAttempts = 5,
  baseDelayMs = 1000,
  jitterRatio = 0.2,
  delay = sleep,
  random = Math.random,
  now = () => new Date(),
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new InvalidRetryOptionsError();
  }

  const firstAttemptAt = now().toISOString();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(message, { attempt, maxAttempts });
    } catch (error) {
      const classification = classifyError(error);
      const shouldRetry = classification === 'TRANSIENT' && attempt < maxAttempts;

      if (shouldRetry) {
        await delay(retryDelay({ attempt, baseDelayMs, jitterRatio, random }));
        continue;
      }

      await deadLetterQueue.publish({
        type: 'DEAD_LETTER',
        originalMessage: message,
        retry: {
          attempts: attempt,
          maxAttempts,
          classification,
          firstAttemptAt,
          failedAt: now().toISOString(),
          lastError: serializeError(error),
        },
      });

      throw new MessageDeadLetteredError({
        attempts: attempt,
        classification,
        cause: error,
      });
    }
  }

  throw new Error('Retry loop exited unexpectedly');
}
