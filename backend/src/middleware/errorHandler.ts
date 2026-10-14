import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `No route matches ${req.method} ${req.originalUrl}`,
  })
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
    return
  }

  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : 500

  if (status >= 500) {
    console.error(error)
  }

  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : 'Request failed',
    message:
      status >= 500
        ? 'Something went wrong while handling this request.'
        : error instanceof Error
          ? error.message
          : 'Request failed',
  })
}
