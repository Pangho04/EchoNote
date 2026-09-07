export abstract class CodedError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, this.constructor.prototype);
  }
}

export function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function isCodedError(error: unknown): error is CodedError {
  return error instanceof CodedError;
}

export function getErrorCode(error: unknown): string | null {
  if (isCodedError(error)) return error.code;

  if (error instanceof Error) return error.name;

  return null;
}
