import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../config/env.ts'

/**
 * Cloudflare R2 (S3-compatible) storage access.
 *
 * All credentials live in backend environment variables and never reach the
 * browser. Files are private by default: clients receive short-lived
 * server-generated presigned URLs instead of permanent public links.
 *
 * In a serverless deployment (Vercel Functions) this module-level client is
 * reused per warm function instance; nothing durable is kept in memory or on
 * the local filesystem.
 */

export const R2_ALLOWED_MIME_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const

export const R2_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export type R2FileCategory =
  | 'school-logos'
  | 'pupil-photos'
  | 'report-pdfs'
  | 'documents'

export type R2UploadInput = {
  contentType: string
  fileSizeBytes: number
  fileName: string
}

let r2Client: S3Client | undefined

function isR2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET_NAME,
  )
}

/**
 * Returns the shared R2 client, creating it on first use so that starting
 * the API (and the /api/health endpoint) never requires R2 credentials.
 */
export function getR2Client(): S3Client {
  if (r2Client === undefined) {
    if (!isR2Configured()) {
      throw new Error(
        'R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME.',
      )
    }
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
      },
    })
  }
  return r2Client
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

/**
 * Builds a namespaced object key. Every object is scoped to a school
 * prefix so ownership checks in later phases can be enforced at the
 * storage-boundary level.
 */
export function buildObjectKey(options: {
  category: R2FileCategory
  schoolId: string
  fileName: string
}): string {
  const schoolId = options.schoolId.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!schoolId) {
    throw new Error('schoolId is required to build an R2 object key')
  }
  return `${options.category}/${schoolId}/${sanitizeFileName(options.fileName)}`
}

/**
 * Validates an upload request before any URL is issued. Ownership of the
 * target school must additionally be verified against the database by the
 * calling route (Phase 2+).
 */
export function assertValidUpload(input: R2UploadInput): void {
  if (!input.fileName.trim()) {
    throw new Error('fileName is required')
  }
  if (!(input.contentType in R2_ALLOWED_MIME_TYPES)) {
    throw new Error(
      `Unsupported file type "${input.contentType}". Allowed: ${Object.keys(R2_ALLOWED_MIME_TYPES).join(', ')}`,
    )
  }
  if (input.fileSizeBytes <= 0) {
    throw new Error('fileSizeBytes must be greater than zero')
  }
  if (input.fileSizeBytes > R2_MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File is too large. Maximum allowed size is ${R2_MAX_FILE_SIZE_BYTES} bytes.`,
    )
  }
}

/** Short-lived presigned download URL for a private object. */
export async function presignR2Download(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    { expiresIn: expiresInSeconds },
  )
}

/** Short-lived presigned upload URL; the backend dictates the content type. */
export async function presignR2Upload(
  options: { key: string; contentType: string },
  expiresInSeconds = 300,
): Promise<string> {
  return getSignedUrl(
    getR2Client(),
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: options.key,
      ContentType: options.contentType,
    }),
    { expiresIn: expiresInSeconds },
  )
}
