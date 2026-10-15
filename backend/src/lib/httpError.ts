/**
 * Minimal HTTP error carrying a status code. The centralised error handler
 * (src/middleware/errorHandler.ts) renders it as a safe JSON error response.
 */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}
