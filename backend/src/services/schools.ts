import type { Pool, PoolClient } from 'pg'

/**
 * School-management data access layer.
 *
 * Every method receives the school ID that was already authorized by the
 * route/middleware. Every query is scoped by school_id; child lookups also use
 * the parent IDs and the database's composite foreign keys as defence in
 * depth. A missing row and a cross-school row are intentionally
 * indistinguishable to callers.
 */

export type ManagementStatus = 'active' | 'archived'

export type ClassLevel = {
  code: string
  label: string
  sortOrder: number
}

export type SchoolProfile = {
  id: string
  name: string
  slug: string
  status: string
  contactEmail: string | null
  phone: string | null
  address: string | null
  hasLogo: boolean
  logoUpdatedAt: Date | null
  profileCompletedAt: Date | null
  setupCompletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type OverviewCounts = {
  classes: number
  sections: number
  subjects: number
  assignments: number
  archivedClasses: number
  archivedSubjects: number
}

export type SchoolOverview = {
  school: SchoolProfile
  setup: {
    complete: boolean
    completedAt: Date | null
    steps: {
      profile: boolean
      classes: boolean
      subjects: boolean
      assignments: boolean
    }
    optional: { logo: boolean }
    counts: OverviewCounts
  }
}

export type SectionRecord = {
  id: string
  classId: string
  name: string
  status: ManagementStatus
  createdAt: Date
  updatedAt: Date
}

export type SchoolClassSummary = {
  id: string
  level: ClassLevel
  status: ManagementStatus
  activeSubjectCount: number
  archivedSubjectCount: number
  createdAt: Date
  updatedAt: Date
}

export type SchoolClass = SchoolClassSummary & {
  sections: SectionRecord[]
}

export type SubjectRecord = {
  id: string
  name: string
  status: ManagementStatus
  activeAssignmentCount: number
  createdAt: Date
  updatedAt: Date
}

export type AssignmentRecord = {
  id: string
  subject: {
    id: string
    name: string
    status: ManagementStatus
  }
  status: ManagementStatus
  createdAt: Date
  updatedAt: Date
}

export type ClassDetail = {
  class: SchoolClassSummary
  sections: SectionRecord[]
  assignments: AssignmentRecord[]
}

export type SchoolLogoRecord = {
  key: string
  contentType: string
  updatedAt: Date
}

export type UpdateProfileInput = {
  name?: string
  contactEmail?: string | null
  phone?: string | null
  address?: string | null
}

export type UpdateSectionInput = {
  name?: string
  status?: ManagementStatus
}

export type UpdateSubjectInput = {
  name?: string
  status?: ManagementStatus
}

export type CreateAssignmentResult = {
  assignment: AssignmentRecord
  created: boolean
}

export type ReplaceLogoResult = {
  logo: SchoolLogoRecord
  previousKey: string | null
}

export interface SchoolService {
  getSchool(schoolId: string): Promise<SchoolProfile | null>
  getOverview(schoolId: string): Promise<SchoolOverview | null>
  updateProfile(
    schoolId: string,
    input: UpdateProfileInput,
  ): Promise<SchoolProfile>
  listLevels(): Promise<ClassLevel[]>
  listClasses(schoolId: string): Promise<SchoolClass[]>
  getClassDetail(
    schoolId: string,
    classId: string,
  ): Promise<ClassDetail | null>
  createClass(schoolId: string, levelCode: string): Promise<SchoolClassSummary>
  updateClassStatus(
    schoolId: string,
    classId: string,
    status: ManagementStatus,
  ): Promise<SchoolClassSummary>
  createSection(
    schoolId: string,
    classId: string,
    name: string,
  ): Promise<SectionRecord>
  updateSection(
    schoolId: string,
    classId: string,
    sectionId: string,
    input: UpdateSectionInput,
  ): Promise<SectionRecord>
  listSubjects(schoolId: string): Promise<SubjectRecord[]>
  createSubject(schoolId: string, name: string): Promise<SubjectRecord>
  updateSubject(
    schoolId: string,
    subjectId: string,
    input: UpdateSubjectInput,
  ): Promise<SubjectRecord>
  createAssignment(
    schoolId: string,
    classId: string,
    subjectId: string,
  ): Promise<CreateAssignmentResult>
  updateAssignmentStatus(
    schoolId: string,
    classId: string,
    subjectId: string,
    status: ManagementStatus,
  ): Promise<AssignmentRecord>
  getLogo(schoolId: string): Promise<SchoolLogoRecord | null>
  setLogo(
    schoolId: string,
    key: string,
    contentType: string,
  ): Promise<ReplaceLogoResult>
  clearLogo(schoolId: string): Promise<string | null>
}

export class SchoolManagementError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'SchoolManagementError'
    this.status = status
    this.code = code
  }
}

type Queryable = Pool | PoolClient

const SCHOOL_PROFILE_COLUMNS = `
  id, name, slug, status, contact_email, phone, address,
  (logo_key IS NOT NULL) AS has_logo,
  logo_updated_at, profile_completed_at, setup_completed_at,
  created_at, updated_at
`

type SchoolProfileRow = {
  id: string
  name: string
  slug: string
  status: string
  contact_email: string | null
  phone: string | null
  address: string | null
  has_logo: boolean
  logo_updated_at: Date | null
  profile_completed_at: Date | null
  setup_completed_at: Date | null
  created_at: Date
  updated_at: Date
}

function mapSchoolProfile(row: SchoolProfileRow): SchoolProfile {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    contactEmail: row.contact_email,
    phone: row.phone,
    address: row.address,
    hasLogo: row.has_logo === true,
    logoUpdatedAt: row.logo_updated_at,
    profileCompletedAt: row.profile_completed_at,
    setupCompletedAt: row.setup_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function asStatus(value: string): ManagementStatus {
  return value === 'archived' ? 'archived' : 'active'
}

function notFound(code: string, message: string): never {
  throw new SchoolManagementError(404, code, message)
}

function conflict(code: string, message: string): never {
  throw new SchoolManagementError(409, code, message)
}

type PgConstraintError = Error & { code?: string; constraint?: string }

function isUniqueViolation(error: unknown): error is PgConstraintError {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as PgConstraintError).code === '23505'
  )
}

function isForeignKeyViolation(error: unknown): error is PgConstraintError {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as PgConstraintError).code === '23503'
  )
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Preserve the original error.
  }
}

async function getSchoolProfile(
  db: Queryable,
  schoolId: string,
): Promise<SchoolProfile | null> {
  const result = await db.query(
    `SELECT ${SCHOOL_PROFILE_COLUMNS} FROM schools WHERE id = $1`,
    [schoolId],
  )
  const row = result.rows[0] as SchoolProfileRow | undefined
  return row ? mapSchoolProfile(row) : null
}

async function markSetupComplete(
  db: Queryable,
  schoolId: string,
): Promise<void> {
  await db.query(
    `UPDATE schools s
     SET setup_completed_at = COALESCE(s.setup_completed_at, now())
     WHERE s.id = $1
       AND s.setup_completed_at IS NULL
       AND s.profile_completed_at IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM school_classes c
         WHERE c.school_id = s.id AND c.status = 'active'
       )
       AND EXISTS (
         SELECT 1 FROM subjects sub
         WHERE sub.school_id = s.id AND sub.status = 'active'
       )
       AND EXISTS (
         SELECT 1
         FROM class_subjects cs
         JOIN school_classes c
           ON c.id = cs.class_id AND c.school_id = cs.school_id
         JOIN subjects sub
           ON sub.id = cs.subject_id AND sub.school_id = cs.school_id
         WHERE cs.school_id = s.id
           AND cs.status = 'active'
           AND c.status = 'active'
           AND sub.status = 'active'
       )`,
    [schoolId],
  )
}

type ClassRow = {
  id: string
  status: string
  level_code: string
  level_label: string
  level_sort_order: number
  active_subject_count: number
  archived_subject_count: number
  created_at: Date
  updated_at: Date
}

function mapClassSummary(row: ClassRow): SchoolClassSummary {
  return {
    id: row.id,
    level: {
      code: row.level_code,
      label: row.level_label,
      sortOrder: row.level_sort_order,
    },
    status: asStatus(row.status),
    activeSubjectCount: row.active_subject_count,
    archivedSubjectCount: row.archived_subject_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const CLASS_SUMMARY_SELECT = `
  SELECT c.id, c.status, c.created_at, c.updated_at,
         l.code AS level_code,
         l.display_name AS level_label,
         l.sort_order AS level_sort_order,
         (
           SELECT count(*)::int FROM class_subjects cs
           WHERE cs.school_id = c.school_id
             AND cs.class_id = c.id
             AND cs.status = 'active'
         ) AS active_subject_count,
         (
           SELECT count(*)::int FROM class_subjects cs
           WHERE cs.school_id = c.school_id
             AND cs.class_id = c.id
             AND cs.status = 'archived'
         ) AS archived_subject_count
  FROM school_classes c
  JOIN class_levels l ON l.code = c.class_level_code
`

async function getClassSummary(
  db: Queryable,
  schoolId: string,
  classId: string,
): Promise<SchoolClassSummary | null> {
  const result = await db.query(
    `${CLASS_SUMMARY_SELECT}
     WHERE c.id = $2 AND c.school_id = $1`,
    [schoolId, classId],
  )
  const row = result.rows[0] as ClassRow | undefined
  return row ? mapClassSummary(row) : null
}

type SectionRow = {
  id: string
  class_id: string
  name: string
  status: string
  created_at: Date
  updated_at: Date
}

function mapSection(row: SectionRow): SectionRecord {
  return {
    id: row.id,
    classId: row.class_id,
    name: row.name,
    status: asStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

type SubjectRow = {
  id: string
  name: string
  status: string
  active_assignment_count: number
  created_at: Date
  updated_at: Date
}

function mapSubject(row: SubjectRow): SubjectRecord {
  return {
    id: row.id,
    name: row.name,
    status: asStatus(row.status),
    activeAssignmentCount: row.active_assignment_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

type AssignmentRow = {
  id: string
  status: string
  created_at: Date
  updated_at: Date
  subject_id: string
  subject_name: string
  subject_status: string
}

function mapAssignment(row: AssignmentRow): AssignmentRecord {
  return {
    id: row.id,
    subject: {
      id: row.subject_id,
      name: row.subject_name,
      status: asStatus(row.subject_status),
    },
    status: asStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const ASSIGNMENT_SELECT = `
  SELECT cs.id, cs.status, cs.created_at, cs.updated_at,
         sub.id AS subject_id, sub.name AS subject_name,
         sub.status AS subject_status
  FROM class_subjects cs
  JOIN subjects sub
    ON sub.id = cs.subject_id AND sub.school_id = cs.school_id
`

async function getAssignment(
  db: Queryable,
  schoolId: string,
  classId: string,
  subjectId: string,
): Promise<AssignmentRecord | null> {
  const result = await db.query(
    `${ASSIGNMENT_SELECT}
     WHERE cs.school_id = $1
       AND cs.class_id = $2
       AND cs.subject_id = $3`,
    [schoolId, classId, subjectId],
  )
  const row = result.rows[0] as AssignmentRow | undefined
  return row ? mapAssignment(row) : null
}

export function createDbSchoolService(getPool: () => Pool): SchoolService {
  return {
    async getSchool(schoolId) {
      return getSchoolProfile(getPool(), schoolId)
    },

    async getOverview(schoolId) {
      const pool = getPool()
      const school = await getSchoolProfile(pool, schoolId)
      if (!school) {
        return null
      }

      const countsResult = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM school_classes
             WHERE school_id = $1 AND status = 'active') AS active_classes,
           (SELECT count(*)::int FROM school_classes
             WHERE school_id = $1 AND status = 'archived') AS archived_classes,
           (SELECT count(*)::int FROM class_sections
             WHERE school_id = $1 AND status = 'active') AS active_sections,
           (SELECT count(*)::int FROM subjects
             WHERE school_id = $1 AND status = 'active') AS active_subjects,
           (SELECT count(*)::int FROM subjects
             WHERE school_id = $1 AND status = 'archived') AS archived_subjects,
           (SELECT count(*)::int
              FROM class_subjects cs
              JOIN school_classes c
                ON c.id = cs.class_id AND c.school_id = cs.school_id
              JOIN subjects sub
                ON sub.id = cs.subject_id AND sub.school_id = cs.school_id
             WHERE cs.school_id = $1
               AND cs.status = 'active'
               AND c.status = 'active'
               AND sub.status = 'active') AS active_assignments`,
        [schoolId],
      )

      const countsRow = countsResult.rows[0] as {
        active_classes: number
        archived_classes: number
        active_sections: number
        active_subjects: number
        archived_subjects: number
        active_assignments: number
      }

      const steps = {
        profile: school.profileCompletedAt !== null,
        classes: countsRow.active_classes > 0,
        subjects: countsRow.active_subjects > 0,
        assignments: countsRow.active_assignments > 0,
      }
      const complete =
        steps.profile && steps.classes && steps.subjects && steps.assignments

      return {
        school,
        setup: {
          complete,
          completedAt: school.setupCompletedAt,
          steps,
          optional: { logo: school.hasLogo },
          counts: {
            classes: countsRow.active_classes,
            sections: countsRow.active_sections,
            subjects: countsRow.active_subjects,
            assignments: countsRow.active_assignments,
            archivedClasses: countsRow.archived_classes,
            archivedSubjects: countsRow.archived_subjects,
          },
        },
      }
    },

    async updateProfile(schoolId, input) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const sets: string[] = []
        const values: unknown[] = [schoolId]
        let index = 2

        if (input.name !== undefined) {
          sets.push(`name = $${index}`)
          values.push(input.name)
          index += 1
        }
        if (input.contactEmail !== undefined) {
          sets.push(`contact_email = $${index}`)
          values.push(input.contactEmail)
          index += 1
        }
        if (input.phone !== undefined) {
          sets.push(`phone = $${index}`)
          values.push(input.phone)
          index += 1
        }
        if (input.address !== undefined) {
          sets.push(`address = $${index}`)
          values.push(input.address)
          index += 1
        }
        sets.push('profile_completed_at = COALESCE(profile_completed_at, now())')

        const updated = await client.query(
          `UPDATE schools
           SET ${sets.join(', ')}
           WHERE id = $1
           RETURNING id`,
          values,
        )
        if (updated.rowCount === 0) {
          notFound('school_not_found', 'School not found')
        }
        await markSetupComplete(client, schoolId)
        const profile = await getSchoolProfile(client, schoolId)
        await client.query('COMMIT')
        if (!profile) {
          notFound('school_not_found', 'School not found')
        }
        return profile
      } catch (error) {
        await rollbackQuietly(client)
        throw error
      } finally {
        client.release()
      }
    },

    async listLevels() {
      const result = await getPool().query(
        `SELECT code, display_name, sort_order
         FROM class_levels
         ORDER BY sort_order ASC`,
      )
      return result.rows.map((row: {
        code: string
        display_name: string
        sort_order: number
      }) => ({
        code: row.code,
        label: row.display_name,
        sortOrder: row.sort_order,
      }))
    },

    async listClasses(schoolId) {
      const pool = getPool()
      const [classesResult, sectionsResult, countsResult] = await Promise.all([
        pool.query(
          `${CLASS_SUMMARY_SELECT}
           WHERE c.school_id = $1
           ORDER BY l.sort_order ASC`,
          [schoolId],
        ),
        pool.query(
          `SELECT id, class_id, name, status, created_at, updated_at
           FROM class_sections
           WHERE school_id = $1
           ORDER BY lower(name) ASC`,
          [schoolId],
        ),
        pool.query(
          `SELECT class_id,
                  count(*) FILTER (WHERE status = 'active')::int AS active_count,
                  count(*) FILTER (WHERE status = 'archived')::int AS archived_count
           FROM class_subjects
           WHERE school_id = $1
           GROUP BY class_id`,
          [schoolId],
        ),
      ])

      const sectionsByClass = new Map<string, SectionRecord[]>()
      for (const row of sectionsResult.rows as SectionRow[]) {
        const list = sectionsByClass.get(row.class_id) ?? []
        list.push(mapSection(row))
        sectionsByClass.set(row.class_id, list)
      }

      const countsByClass = new Map<
        string,
        { active: number; archived: number }
      >()
      for (const row of countsResult.rows as Array<{
        class_id: string
        active_count: number
        archived_count: number
      }>) {
        countsByClass.set(row.class_id, {
          active: row.active_count,
          archived: row.archived_count,
        })
      }

      return (classesResult.rows as ClassRow[]).map((row) => {
        const summary = mapClassSummary(row)
        const counts = countsByClass.get(row.id)
        return {
          ...summary,
          activeSubjectCount: counts?.active ?? summary.activeSubjectCount,
          archivedSubjectCount:
            counts?.archived ?? summary.archivedSubjectCount,
          sections: sectionsByClass.get(row.id) ?? [],
        }
      })
    },

    async getClassDetail(schoolId, classId) {
      const pool = getPool()
      const summary = await getClassSummary(pool, schoolId, classId)
      if (!summary) {
        return null
      }

      const [sectionsResult, assignmentsResult] = await Promise.all([
        pool.query(
          `SELECT id, class_id, name, status, created_at, updated_at
           FROM class_sections
           WHERE school_id = $1 AND class_id = $2
           ORDER BY lower(name) ASC`,
          [schoolId, classId],
        ),
        pool.query(
          `${ASSIGNMENT_SELECT}
           WHERE cs.school_id = $1 AND cs.class_id = $2
           ORDER BY lower(sub.name) ASC`,
          [schoolId, classId],
        ),
      ])

      return {
        class: summary,
        sections: (sectionsResult.rows as SectionRow[]).map(mapSection),
        assignments: (assignmentsResult.rows as AssignmentRow[]).map(
          mapAssignment,
        ),
      }
    },

    async createClass(schoolId, levelCode) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const inserted = await client.query(
          `INSERT INTO school_classes (school_id, class_level_code)
           VALUES ($1, $2)
           ON CONFLICT (school_id, class_level_code) DO NOTHING
           RETURNING id`,
          [schoolId, levelCode],
        )
        if (inserted.rowCount === 0) {
          conflict(
            'class_already_exists',
            'A class already exists for that school level',
          )
        }
        const classId = inserted.rows[0].id as string
        await markSetupComplete(client, schoolId)
        const summary = await getClassSummary(client, schoolId, classId)
        await client.query('COMMIT')
        if (!summary) {
          notFound('class_not_found', 'Class not found')
        }
        return summary
      } catch (error) {
        await rollbackQuietly(client)
        if (isForeignKeyViolation(error)) {
          throw new SchoolManagementError(
            400,
            'invalid_level',
            'Unknown class level',
          )
        }
        throw error
      } finally {
        client.release()
      }
    },

    async updateClassStatus(schoolId, classId, status) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await client.query(
          `UPDATE school_classes
           SET status = $3
           WHERE id = $2 AND school_id = $1
           RETURNING id`,
          [schoolId, classId, status],
        )
        if (result.rowCount === 0) {
          notFound('class_not_found', 'Class not found')
        }
        if (status === 'active') {
          await markSetupComplete(client, schoolId)
        }
        const summary = await getClassSummary(client, schoolId, classId)
        await client.query('COMMIT')
        if (!summary) {
          notFound('class_not_found', 'Class not found')
        }
        return summary
      } catch (error) {
        await rollbackQuietly(client)
        throw error
      } finally {
        client.release()
      }
    },

    async createSection(schoolId, classId, name) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const parent = await client.query(
          `SELECT status FROM school_classes
           WHERE id = $2 AND school_id = $1
           FOR UPDATE`,
          [schoolId, classId],
        )
        if (parent.rowCount === 0) {
          notFound('class_not_found', 'Class not found')
        }
        if (parent.rows[0].status !== 'active') {
          conflict('parent_archived', 'Cannot add a section to an archived class')
        }

        const result = await client.query(
          `INSERT INTO class_sections (school_id, class_id, name)
           VALUES ($1, $2, $3)
           RETURNING id, class_id, name, status, created_at, updated_at`,
          [schoolId, classId, name],
        )
        await client.query('COMMIT')
        return mapSection(result.rows[0] as SectionRow)
      } catch (error) {
        await rollbackQuietly(client)
        if (isUniqueViolation(error)) {
          conflict('section_name_taken', 'A section with that name already exists')
        }
        throw error
      } finally {
        client.release()
      }
    },

    async updateSection(schoolId, classId, sectionId, input) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const existing = await client.query(
          `SELECT sec.id, c.status AS class_status
           FROM class_sections sec
           JOIN school_classes c
             ON c.id = sec.class_id AND c.school_id = sec.school_id
           WHERE sec.id = $3 AND sec.class_id = $2 AND sec.school_id = $1
           FOR UPDATE OF sec, c`,
          [schoolId, classId, sectionId],
        )
        if (existing.rowCount === 0) {
          notFound('section_not_found', 'Section not found')
        }
        if (
          input.status === 'active' &&
          existing.rows[0].class_status !== 'active'
        ) {
          conflict(
            'parent_archived',
            'Cannot reactivate a section in an archived class',
          )
        }

        const sets: string[] = []
        const values: unknown[] = [schoolId, classId, sectionId]
        let index = 4
        if (input.name !== undefined) {
          sets.push(`name = $${index}`)
          values.push(input.name)
          index += 1
        }
        if (input.status !== undefined) {
          sets.push(`status = $${index}`)
          values.push(input.status)
        }

        const result = await client.query(
          `UPDATE class_sections
           SET ${sets.join(', ')}
           WHERE id = $3 AND class_id = $2 AND school_id = $1
           RETURNING id, class_id, name, status, created_at, updated_at`,
          values,
        )
        await client.query('COMMIT')
        return mapSection(result.rows[0] as SectionRow)
      } catch (error) {
        await rollbackQuietly(client)
        if (isUniqueViolation(error)) {
          conflict('section_name_taken', 'A section with that name already exists')
        }
        throw error
      } finally {
        client.release()
      }
    },

    async listSubjects(schoolId) {
      const result = await getPool().query(
        `SELECT s.id, s.name, s.status, s.created_at, s.updated_at,
                (
                  SELECT count(*)::int FROM class_subjects cs
                  WHERE cs.school_id = s.school_id
                    AND cs.subject_id = s.id
                    AND cs.status = 'active'
                ) AS active_assignment_count
         FROM subjects s
         WHERE s.school_id = $1
         ORDER BY lower(s.name) ASC`,
        [schoolId],
      )
      return (result.rows as SubjectRow[]).map(mapSubject)
    },

    async createSubject(schoolId, name) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await client.query(
          `INSERT INTO subjects (school_id, name)
           VALUES ($1, $2)
           RETURNING id, name, status, created_at, updated_at`,
          [schoolId, name],
        )
        await markSetupComplete(client, schoolId)
        await client.query('COMMIT')
        return {
          ...mapSubject({
            ...(result.rows[0] as Omit<SubjectRow, 'active_assignment_count'>),
            active_assignment_count: 0,
          }),
        }
      } catch (error) {
        await rollbackQuietly(client)
        if (isUniqueViolation(error)) {
          conflict('subject_name_taken', 'A subject with that name already exists')
        }
        throw error
      } finally {
        client.release()
      }
    },

    async updateSubject(schoolId, subjectId, input) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const sets: string[] = []
        const values: unknown[] = [schoolId, subjectId]
        let index = 3
        if (input.name !== undefined) {
          sets.push(`name = $${index}`)
          values.push(input.name)
          index += 1
        }
        if (input.status !== undefined) {
          sets.push(`status = $${index}`)
          values.push(input.status)
        }

        const result = await client.query(
          `UPDATE subjects
           SET ${sets.join(', ')}
           WHERE id = $2 AND school_id = $1
           RETURNING id, name, status, created_at, updated_at`,
          values,
        )
        if (result.rowCount === 0) {
          notFound('subject_not_found', 'Subject not found')
        }
        if (input.status === 'active') {
          await markSetupComplete(client, schoolId)
        }
        const countResult = await client.query(
          `SELECT count(*)::int AS active_assignment_count
           FROM class_subjects
           WHERE school_id = $1 AND subject_id = $2 AND status = 'active'`,
          [schoolId, subjectId],
        )
        await client.query('COMMIT')
        return mapSubject({
          ...(result.rows[0] as Omit<SubjectRow, 'active_assignment_count'>),
          active_assignment_count: countResult.rows[0]
            .active_assignment_count as number,
        })
      } catch (error) {
        await rollbackQuietly(client)
        if (isUniqueViolation(error)) {
          conflict('subject_name_taken', 'A subject with that name already exists')
        }
        throw error
      } finally {
        client.release()
      }
    },

    async createAssignment(schoolId, classId, subjectId) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const parent = await client.query(
          `SELECT c.status AS class_status,
                  sub.status AS subject_status,
                  sub.name AS subject_name,
                  sub.id AS subject_id
           FROM school_classes c
           JOIN subjects sub
             ON sub.id = $3 AND sub.school_id = $1
           WHERE c.id = $2 AND c.school_id = $1
           FOR UPDATE OF c, sub`,
          [schoolId, classId, subjectId],
        )
        if (parent.rowCount === 0) {
          notFound('class_not_found', 'Class or subject not found')
        }
        const parentRow = parent.rows[0] as {
          class_status: string
          subject_status: string
          subject_name: string
          subject_id: string
        }
        if (
          parentRow.class_status !== 'active' ||
          parentRow.subject_status !== 'active'
        ) {
          conflict(
            'parent_archived',
            'Cannot assign a subject to an archived class or archived subject',
          )
        }

        const upsert = await client.query(
          `INSERT INTO class_subjects (school_id, class_id, subject_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (class_id, subject_id) DO UPDATE
             SET status = 'active', updated_at = now()
           RETURNING id, status, created_at, updated_at,
                     (xmax = 0) AS created`,
          [schoolId, classId, subjectId],
        )
        const assignment = await getAssignment(client, schoolId, classId, subjectId)
        await markSetupComplete(client, schoolId)
        await client.query('COMMIT')
        if (!assignment) {
          notFound('assignment_not_found', 'Assignment not found')
        }
        return {
          assignment,
          created: upsert.rows[0]?.created === true,
        }
      } catch (error) {
        await rollbackQuietly(client)
        throw error
      } finally {
        client.release()
      }
    },

    async updateAssignmentStatus(schoolId, classId, subjectId, status) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const existing = await client.query(
          `SELECT cs.id, c.status AS class_status,
                  sub.status AS subject_status
           FROM class_subjects cs
           JOIN school_classes c
             ON c.id = cs.class_id AND c.school_id = cs.school_id
           JOIN subjects sub
             ON sub.id = cs.subject_id AND sub.school_id = cs.school_id
           WHERE cs.school_id = $1
             AND cs.class_id = $2
             AND cs.subject_id = $3
           FOR UPDATE OF cs, c, sub`,
          [schoolId, classId, subjectId],
        )
        if (existing.rowCount === 0) {
          notFound('assignment_not_found', 'Assignment not found')
        }
        if (
          status === 'active' &&
          (existing.rows[0].class_status !== 'active' ||
            existing.rows[0].subject_status !== 'active')
        ) {
          conflict(
            'parent_archived',
            'Cannot reactivate an assignment whose class or subject is archived',
          )
        }

        await client.query(
          `UPDATE class_subjects
           SET status = $4
           WHERE school_id = $1 AND class_id = $2 AND subject_id = $3`,
          [schoolId, classId, subjectId, status],
        )
        const assignment = await getAssignment(client, schoolId, classId, subjectId)
        if (status === 'active') {
          await markSetupComplete(client, schoolId)
        }
        await client.query('COMMIT')
        if (!assignment) {
          notFound('assignment_not_found', 'Assignment not found')
        }
        return assignment
      } catch (error) {
        await rollbackQuietly(client)
        throw error
      } finally {
        client.release()
      }
    },

    async getLogo(schoolId) {
      const result = await getPool().query(
        `SELECT logo_key, logo_content_type, logo_updated_at
         FROM schools WHERE id = $1`,
        [schoolId],
      )
      const row = result.rows[0] as
        | {
            logo_key: string | null
            logo_content_type: string | null
            logo_updated_at: Date | null
          }
        | undefined
      if (!row || row.logo_key === null) {
        return null
      }
      return {
        key: row.logo_key,
        contentType: row.logo_content_type ?? 'image/png',
        updatedAt: row.logo_updated_at ?? new Date(0),
      }
    },

    async setLogo(schoolId, key, contentType) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const existing = await client.query(
          `SELECT logo_key FROM schools WHERE id = $1 FOR UPDATE`,
          [schoolId],
        )
        if (existing.rowCount === 0) {
          notFound('school_not_found', 'School not found')
        }
        const updated = await client.query(
          `UPDATE schools
           SET logo_key = $2,
               logo_content_type = $3,
               logo_updated_at = now()
           WHERE id = $1
           RETURNING logo_key, logo_content_type, logo_updated_at`,
          [schoolId, key, contentType],
        )
        await client.query('COMMIT')
        const row = updated.rows[0] as {
          logo_key: string
          logo_content_type: string
          logo_updated_at: Date
        }
        return {
          logo: {
            key: row.logo_key,
            contentType: row.logo_content_type,
            updatedAt: row.logo_updated_at,
          },
          previousKey: (existing.rows[0]?.logo_key as string | null) ?? null,
        }
      } catch (error) {
        await rollbackQuietly(client)
        throw error
      } finally {
        client.release()
      }
    },

    async clearLogo(schoolId) {
      const pool = getPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const existing = await client.query(
          `SELECT logo_key FROM schools WHERE id = $1 FOR UPDATE`,
          [schoolId],
        )
        if (existing.rowCount === 0) {
          notFound('school_not_found', 'School not found')
        }
        const previousKey = (existing.rows[0]?.logo_key as string | null) ?? null
        await client.query(
          `UPDATE schools
           SET logo_key = NULL,
               logo_content_type = NULL,
               logo_updated_at = NULL
           WHERE id = $1`,
          [schoolId],
        )
        await client.query('COMMIT')
        return previousKey
      } catch (error) {
        await rollbackQuietly(client)
        throw error
      } finally {
        client.release()
      }
    },
  }
}
