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
  constructor(message) {
    super(message);
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

export class RetryInfrastructureError extends AggregateError {
  constructor({ stage, attempts, classification, processingError, infrastructureError }) {
    super(
      [processingError, infrastructureError],
      `Retry infrastructure failed during ${stage.toLowerCase()}`,
      { cause: processingError },
    );
    this.name = 'RetryInfrastructureError';
    this.code = 'RETRY_INFRASTRUCTURE_ERROR';
    this.stage = stage;
    this.attempts = attempts;
    this.classification = classification;
    this.processingError = processingError;
    this.infrastructureError = infrastructureError;
  }
}

function classifyError(error) {
  return error instanceof TransientError ? 'TRANSIENT' : 'PERMANENT';
}

function retryDelay({ attempt, baseDelayMs, jitterRatio, random }) {
  const exponentialDelay = baseDelayMs * 2 ** (attempt - 1);
  const randomValue = random();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
    throw new InvalidRetryOptionsError('Random source must return a number between zero and one');
  }
  const jitterMultiplier = 1 - jitterRatio + 2 * jitterRatio * randomValue;
  return Math.round(exponentialDelay * jitterMultiplier);
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return {
      name: 'NonErrorThrown',
      message: String(error),
    };
  }

  return {
    name: error.name,
    message: error.message,
    ...(error.code ? { code: error.code } : {}),
  };
}

export function createRetryingQueueProcessor({
  sourceQueue,
  deadLetterQueue,
  operation,
  retryOptions = {},
}) {
  async function process(message) {
    try {
      await executeWithRetry({
        ...retryOptions,
        message,
        operation,
        deadLetterQueue,
      });
    } catch (error) {
      if (!(error instanceof MessageDeadLetteredError)) {
        throw error;
      }
    }
  }

  return {
    start() {
      return sourceQueue.consume(process);
    },
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
    throw new InvalidRetryOptionsError('Maximum attempts must be a positive integer');
  }

  if (!Number.isFinite(baseDelayMs) || baseDelayMs <= 0) {
    throw new InvalidRetryOptionsError('Base delay must be a positive finite number');
  }

  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new InvalidRetryOptionsError('Jitter ratio must be between zero and one');
  }

  const originalMessage = structuredClone(message);
  const firstAttemptAt = now().toISOString();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(message, { attempt, maxAttempts });
    } catch (error) {
      const classification = classifyError(error);
      const shouldRetry = classification === 'TRANSIENT' && attempt < maxAttempts;

      if (shouldRetry) {
        try {
          await delay(retryDelay({ attempt, baseDelayMs, jitterRatio, random }));
        } catch (infrastructureError) {
          throw new RetryInfrastructureError({
            stage: 'RETRY_DELAY',
            attempts: attempt,
            classification,
            processingError: error,
            infrastructureError,
          });
        }
        continue;
      }

      try {
        await deadLetterQueue.publish({
          type: 'DEAD_LETTER',
          originalMessage,
          retry: {
            attempts: attempt,
            maxAttempts,
            classification,
            firstAttemptAt,
            failedAt: now().toISOString(),
            lastError: serializeError(error),
          },
        });
      } catch (infrastructureError) {
        throw new RetryInfrastructureError({
          stage: 'DEAD_LETTER_PUBLICATION',
          attempts: attempt,
          classification,
          processingError: error,
          infrastructureError,
        });
      }

      throw new MessageDeadLetteredError({
        attempts: attempt,
        classification,
        cause: error,
      });
    }
  }

  throw new Error('Retry loop exited unexpectedly');
}
