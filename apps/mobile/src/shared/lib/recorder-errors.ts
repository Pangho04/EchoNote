export abstract class RecorderError extends Error {
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

export function isRecorderError(error: unknown): error is RecorderError {
  return error instanceof RecorderError;
}

export function getRecorderErrorCode(error: unknown): string | null {
  if (isRecorderError(error)) return error.code;
  if (error instanceof Error) return error.name;
  return null;
}
