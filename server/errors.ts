export class HttpError extends Error {
  status: number;
  retryAfter?: number;
  remainingAttempts?: number;

  constructor(status: number, message: string, retryAfter?: number, remainingAttempts?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.remainingAttempts = remainingAttempts;
  }
}
