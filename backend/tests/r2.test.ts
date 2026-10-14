import { describe, expect, it } from 'vitest'
import {
  R2_MAX_FILE_SIZE_BYTES,
  assertValidUpload,
  buildObjectKey,
} from '../src/lib/r2.ts'

describe('assertValidUpload', () => {
  it('accepts a valid image upload', () => {
    expect(() =>
      assertValidUpload({
        contentType: 'image/png',
        fileSizeBytes: 1024,
        fileName: 'logo.png',
      }),
    ).not.toThrow()
  })

  it('rejects disallowed file types', () => {
    expect(() =>
      assertValidUpload({
        contentType: 'application/x-msdownload',
        fileSizeBytes: 1024,
        fileName: 'malware.exe',
      }),
    ).toThrow(/Unsupported file type/)
  })

  it('rejects oversized files', () => {
    expect(() =>
      assertValidUpload({
        contentType: 'application/pdf',
        fileSizeBytes: R2_MAX_FILE_SIZE_BYTES + 1,
        fileName: 'report.pdf',
      }),
    ).toThrow(/too large/)
  })

  it('rejects empty file names and zero-size files', () => {
    expect(() =>
      assertValidUpload({
        contentType: 'image/png',
        fileSizeBytes: 10,
        fileName: '   ',
      }),
    ).toThrow(/fileName is required/)
    expect(() =>
      assertValidUpload({
        contentType: 'image/png',
        fileSizeBytes: 0,
        fileName: 'logo.png',
      }),
    ).toThrow(/greater than zero/)
  })
})

describe('buildObjectKey', () => {
  it('namespaces objects under the school prefix', () => {
    expect(
      buildObjectKey({
        category: 'report-pdfs',
        schoolId: 'school_1',
        fileName: 'report.pdf',
      }),
    ).toBe('report-pdfs/school_1/report.pdf')
  })

  it('sanitizes file names and school ids', () => {
    const key = buildObjectKey({
      category: 'pupil-photos',
      schoolId: 'school 1/../etc',
      fileName: 'photo one.png',
    })
    expect(key.startsWith('pupil-photos/school1etc/')).toBe(true)
    expect(key).toContain('photo_one.png')
  })

  it('requires a school id', () => {
    expect(() =>
      buildObjectKey({
        category: 'documents',
        schoolId: '###',
        fileName: 'doc.pdf',
      }),
    ).toThrow(/schoolId is required/)
  })
})
