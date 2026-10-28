import { vi } from 'vitest'
import type { SchoolLogoStorage } from '../../src/services/schoolLogoStorage.ts'

export type FakeLogoStorage = SchoolLogoStorage & {
  configured: boolean
  setHead: (
    value: { contentType: string | undefined; contentLength: number | undefined } | null,
  ) => void
}

export function createFakeLogoStorage(options: { configured?: boolean } = {}): FakeLogoStorage {
  let configured = options.configured ?? true
  let head: { contentType: string | undefined; contentLength: number | undefined } | null =
    { contentType: 'image/png', contentLength: 1024 }

  const storage = {
    get configured() {
      return configured
    },
    set configured(value: boolean) {
      configured = value
    },
    isConfigured: vi.fn(() => configured),
    createUpload: vi.fn(async () => ({
      url: 'https://r2.test/upload',
      expiresAt: new Date(Date.now() + 300_000),
    })),
    head: vi.fn(async () => head),
    presignDownload: vi.fn(async () => 'https://r2.test/download'),
    delete: vi.fn(async () => undefined),
    setHead(value: typeof head) {
      head = value
    },
  }

  return storage as unknown as FakeLogoStorage
}
