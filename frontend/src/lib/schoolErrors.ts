import { ApiError } from './api.ts'

/**
 * Converts API failures into short, user-safe messages. Server 5xx responses
 * intentionally carry no internal detail, so those map to a generic message.
 */
export function describeApiError(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (!(error instanceof ApiError)) return fallback

  const details = error.details as
    | { code?: string; message?: string }
    | undefined

  switch (details?.code) {
    case 'class_already_exists':
      return 'A class already exists for that level. Open it to manage it instead.'
    case 'section_name_taken':
      return 'A section with that name already exists in this class.'
    case 'subject_name_taken':
      return 'A subject with that name already exists.'
    case 'parent_archived':
      return 'This action is unavailable while the class or subject is archived.'
    case 'invalid_level':
      return 'That class level is not valid.'
    case 'logo_storage_unavailable':
      return 'Logo storage is not configured. You can still save the other school details.'
    case 'logo_upload_incomplete':
      return 'The logo upload did not finish. Please try again.'
    case 'logo_upload_invalid':
      return 'That file did not pass the image type or size check.'
    default:
      break
  }

  if (error.status === 0) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (error.status === 401) {
    return 'Your session has expired. Please sign in again.'
  }
  if (error.status === 403) {
    return 'You do not have permission to perform this action.'
  }
  if (error.status === 404) {
    return 'That item was not found or you no longer have access to it.'
  }
  if (error.status === 429) {
    return 'Too many attempts. Please wait a few minutes and try again.'
  }
  if (error.status >= 500) {
    return 'This feature is temporarily unavailable. Please try again later.'
  }

  return details?.message || error.message || fallback
}
