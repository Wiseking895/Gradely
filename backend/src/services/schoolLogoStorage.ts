import {
  buildSchoolLogoObjectKey,
  deleteR2Object,
  headR2Object,
  isR2Configured,
  presignR2Download,
  presignR2Upload,
  type R2HeadResult,
  type SchoolLogoMimeType,
} from '../lib/r2.ts'

/**
 * Narrow storage boundary for school logos. The HTTP tests inject an in-memory
 * implementation, while production uses the existing R2 helper. No client ever
 * receives an object key.
 */
export interface SchoolLogoStorage {
  isConfigured(): boolean
  createUpload(input: {
    schoolId: string
    uploadId: string
    contentType: SchoolLogoMimeType
  }): Promise<{ url: string; expiresAt: Date }>
  head(key: string): Promise<R2HeadResult | null>
  presignDownload(key: string): Promise<string>
  delete(key: string): Promise<void>
}

const UPLOAD_URL_TTL_SECONDS = 300
const DOWNLOAD_URL_TTL_SECONDS = 300

export function createR2SchoolLogoStorage(): SchoolLogoStorage {
  return {
    isConfigured: () => isR2Configured(),

    async createUpload(input) {
      const key = buildSchoolLogoObjectKey(input)
      const url = await presignR2Upload(
        { key, contentType: input.contentType },
        UPLOAD_URL_TTL_SECONDS,
      )
      return {
        url,
        expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
      }
    },

    head: (key) => headR2Object(key),

    presignDownload: (key) => presignR2Download(key, DOWNLOAD_URL_TTL_SECONDS),

    delete: (key) => deleteR2Object(key),
  }
}
