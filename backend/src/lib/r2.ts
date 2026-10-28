import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
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

/** School logos are a separate, stricter tenant-data category. */
export const R2_SCHOOL_LOGO_MIME_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const

export type SchoolLogoMimeType = keyof typeof R2_SCHOOL_LOGO_MIME_TYPES

export const R2_SCHOOL_LOGO_MAX_SIZE_BYTES = 2 * 1024 * 1024 // 2 MB

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

export function isR2Configured(): boolean {
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

export function isSchoolLogoMimeType(
  value: string,
): value is SchoolLogoMimeType {
  return value in R2_SCHOOL_LOGO_MIME_TYPES
}

export function extensionForSchoolLogoMimeType(
  contentType: SchoolLogoMimeType,
): string {
  return R2_SCHOOL_LOGO_MIME_TYPES[contentType]
}

export function assertValidSchoolLogoUpload(input: {
  contentType: string
  fileSizeBytes: number
}): asserts input is {
  contentType: SchoolLogoMimeType
  fileSizeBytes: number
} {
  if (!isSchoolLogoMimeType(input.contentType)) {
    throw new Error(
      `Unsupported school logo type "${input.contentType}". Allowed: ${Object.keys(R2_SCHOOL_LOGO_MIME_TYPES).join(', ')}`,
    )
  }
  if (!Number.isInteger(input.fileSizeBytes) || input.fileSizeBytes <= 0) {
    throw new Error('fileSizeBytes must be a positive integer')
  }
  if (input.fileSizeBytes > R2_SCHOOL_LOGO_MAX_SIZE_BYTES) {
    throw new Error(
      `School logo is too large. Maximum allowed size is ${R2_SCHOOL_LOGO_MAX_SIZE_BYTES} bytes (2 MB).`,
    )
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Builds the one server-authoritative key format for school logos:
 * school-logos/{schoolId}/{uploadId}.{png|jpg|webp}
 *
 * Clients never supply the key. Both IDs are validated UUIDs, so path
 * traversal or cross-school prefixes are impossible.
 */
export function buildSchoolLogoObjectKey(input: {
  schoolId: string
  uploadId: string
  contentType: SchoolLogoMimeType
}): string {
  if (!UUID_PATTERN.test(input.schoolId)) {
    throw new Error('schoolId must be a UUID to build a school-logo key')
  }
  if (!UUID_PATTERN.test(input.uploadId)) {
    throw new Error('uploadId must be a UUID to build a school-logo key')
  }
  return buildObjectKey({
    category: 'school-logos',
    schoolId: input.schoolId,
    fileName: `${input.uploadId}.${extensionForSchoolLogoMimeType(input.contentType)}`,
  })
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

export type R2HeadResult = {
  contentType: string | undefined
  contentLength: number | undefined
}

function isObjectMissing(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const candidate = error as Error & {
    name?: string
    Code?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.Code === 'NotFound' ||
    candidate.Code === 'NoSuchKey' ||
    candidate.$metadata?.httpStatusCode === 404
  )
}

/**
 * Server-side verification used before persisting a client-uploaded object.
 * Returns null only for a confirmed missing object; other R2 failures throw so
 * callers can distinguish "not uploaded yet" from "storage unavailable".
 */
export async function headR2Object(key: string): Promise<R2HeadResult | null> {
  try {
    const result = await getR2Client().send(
      new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    )
    return {
      contentType: result.ContentType,
      contentLength:
        typeof result.ContentLength === 'number' ? result.ContentLength : undefined,
    }
  } catch (error) {
    if (isObjectMissing(error)) {
      return null
    }
    throw error
  }
}

/** Deletes a private object. Callers perform best-effort cleanup and log safely. */
export async function deleteR2Object(key: string): Promise<void> {
  await getR2Client().send(
    new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
  )
}
