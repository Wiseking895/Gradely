import type { AuthSession } from '../services/auth.ts'

/**
 * Express Request augmentation: the authentication middleware attaches the
 * verified session (if any) and the raw session token (for logout).
 */
declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthSession
    sessionToken?: string
  }
}

export {}
