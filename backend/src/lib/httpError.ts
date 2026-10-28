/**
 * Minimal HTTP error carrying a status code (and an optional machine-readable
 * `code` for clients that need to branch on specific failures, e.g. the
 * email-verification states). The centralised error handler
 * (src/middleware/errorHandler.ts) renders it as a safe JSON error response.
 */
export class HttpError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}
