import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import type {
  ClassLevel,
  SchoolClassSummary,
  SchoolOverview,
  SchoolProfile,
  SchoolService,
  SubjectRecord,
} from '../../src/services/schools.ts'

/**
 * Lightweight mock service for HTTP tests. Database behavior is covered by
 * schools.db.test.ts; these mocks let route tests exercise middleware,
 * validation, status codes, and response shaping without a database.
 */
export type FakeSchoolService = SchoolService & {
  defaultSchoolId: string
  defaultProfile: SchoolProfile
  defaultOverview: SchoolOverview
  levels: ClassLevel[]
}

const now = new Date('2026-01-01T00:00:00.000Z')

export const TEST_CLASS_LEVELS: ClassLevel[] = [
  { code: 'creche', label: 'Creche', sortOrder: 1 },
  { code: 'nursery_1', label: 'Nursery 1', sortOrder: 2 },
  { code: 'nursery_2', label: 'Nursery 2', sortOrder: 3 },
  { code: 'kg_1', label: 'KG 1', sortOrder: 4 },
  { code: 'kg_2', label: 'KG 2', sortOrder: 5 },
  { code: 'basic_1', label: 'Basic 1', sortOrder: 6 },
  { code: 'basic_2', label: 'Basic 2', sortOrder: 7 },
  { code: 'basic_3', label: 'Basic 3', sortOrder: 8 },
  { code: 'basic_4', label: 'Basic 4', sortOrder: 9 },
  { code: 'basic_5', label: 'Basic 5', sortOrder: 10 },
  { code: 'basic_6', label: 'Basic 6', sortOrder: 11 },
  { code: 'jhs_1', label: 'JHS 1', sortOrder: 12 },
  { code: 'jhs_2', label: 'JHS 2', sortOrder: 13 },
  { code: 'jhs_3', label: 'JHS 3', sortOrder: 14 },
]

export function makeProfile(
  overrides: Partial<SchoolProfile> = {},
): SchoolProfile {
  return {
    id: randomUUID(),
    name: 'Bright Future School',
    slug: 'bright-future-school',
    status: 'active',
    contactEmail: null,
    phone: null,
    address: null,
    hasLogo: false,
    logoUpdatedAt: null,
    profileCompletedAt: null,
    setupCompletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function makeClass(
  overrides: Partial<SchoolClassSummary> = {},
): SchoolClassSummary {
  return {
    id: randomUUID(),
    level: TEST_CLASS_LEVELS[5],
    status: 'active',
    activeSubjectCount: 0,
    archivedSubjectCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function makeSubject(
  overrides: Partial<SubjectRecord> = {},
): SubjectRecord {
  return {
    id: randomUUID(),
    name: 'Mathematics',
    status: 'active',
    activeAssignmentCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeSchoolService(
  options: { school?: SchoolProfile } = {},
): FakeSchoolService {
  const defaultProfile = options.school ?? makeProfile()
  const defaultOverview: SchoolOverview = {
    school: defaultProfile,
    setup: {
      complete: false,
      completedAt: null,
      steps: {
        profile: false,
        classes: false,
        subjects: false,
        assignments: false,
      },
      optional: { logo: false },
      counts: {
        classes: 0,
        sections: 0,
        subjects: 0,
        assignments: 0,
        archivedClasses: 0,
        archivedSubjects: 0,
      },
    },
  }

  const service = {
    defaultSchoolId: defaultProfile.id,
    defaultProfile,
    defaultOverview,
    levels: TEST_CLASS_LEVELS,

    getSchool: vi.fn(async () => defaultProfile),
    getOverview: vi.fn(async () => defaultOverview),
    updateProfile: vi.fn(
      async (_schoolId: string, input: Partial<SchoolProfile>) => ({
        ...defaultProfile,
        ...input,
        profileCompletedAt: defaultProfile.profileCompletedAt ?? now,
      }),
    ),
    listLevels: vi.fn(async () => TEST_CLASS_LEVELS),
    listClasses: vi.fn(async () => []),
    getClassDetail: vi.fn(async () => null),
    createClass: vi.fn(async () => makeClass()),
    updateClassStatus: vi.fn(async () => makeClass()),
    createSection: vi.fn(async () => ({
      id: randomUUID(),
      classId: randomUUID(),
      name: 'A',
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    })),
    updateSection: vi.fn(async () => ({
      id: randomUUID(),
      classId: randomUUID(),
      name: 'A',
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    })),
    listSubjects: vi.fn(async () => []),
    createSubject: vi.fn(async () => makeSubject()),
    updateSubject: vi.fn(async () => makeSubject()),
    createAssignment: vi.fn(async () => ({
      created: true,
      assignment: {
        id: randomUUID(),
        subject: {
          id: randomUUID(),
          name: 'Mathematics',
          status: 'active' as const,
        },
        status: 'active' as const,
        createdAt: now,
        updatedAt: now,
      },
    })),
    updateAssignmentStatus: vi.fn(async () => ({
      id: randomUUID(),
      subject: {
        id: randomUUID(),
        name: 'Mathematics',
        status: 'active' as const,
      },
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    })),
    getLogo: vi.fn(async () => null),
    setLogo: vi.fn(async () => ({
      logo: {
        key: 'internal',
        contentType: 'image/png',
        updatedAt: now,
      },
      previousKey: null,
    })),
    clearLogo: vi.fn(async () => null),
  }

  return service as unknown as FakeSchoolService
}
