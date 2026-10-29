import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import {
  createDbSchoolService,
  type SchoolService,
} from '../src/services/schools.ts'
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase.ts'

describe('school management schema + service (integration)', () => {
  let database: TestDatabase
  let pool: Pool
  let schools: SchoolService

  async function createSchool(name: string, slug: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO schools (name, slug, status)
       VALUES ($1, $2, 'active')
       RETURNING id`,
      [name, slug],
    )
    return result.rows[0].id as string
  }

  beforeAll(async () => {
    database = await createTestDatabase()
    pool = database.pool
    schools = createDbSchoolService(() => pool)
  }, 60_000)

  afterAll(async () => {
    if (database) {
      await database.close()
    }
  })

  it('applies all four migrations and seeds the exact 14-level progression', async () => {
    expect(database.migrationFiles).toEqual([
      '0001_auth_foundation.sql',
      '0002_email_verification.sql',
      '0003_school_verification_lifecycle.sql',
      '0004_school_management.sql',
    ])

    const applied = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM schema_migrations',
    )
    expect(applied.rows[0].count).toBe(4)

    const levels = await schools.listLevels()
    expect(levels.map((level) => level.label)).toEqual([
      'Creche',
      'Nursery 1',
      'Nursery 2',
      'KG 1',
      'KG 2',
      'Basic 1',
      'Basic 2',
      'Basic 3',
      'Basic 4',
      'Basic 5',
      'Basic 6',
      'JHS 1',
      'JHS 2',
      'JHS 3',
    ])
    expect(levels.map((level) => level.sortOrder)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ])
    expect(new Set(levels.map((level) => level.code)).size).toBe(14)
  })

  it('updates the editable profile, keeps the slug immutable, and records setup completion', async () => {
    const schoolId = await createSchool('Profile School', 'profile-school')

    const updated = await schools.updateProfile(schoolId, {
      name: 'Profile School Renamed',
      contactEmail: 'office@profile.test',
      phone: '+233 20 000 0000',
      address: '12 Education Road',
    })
    expect(updated.name).toBe('Profile School Renamed')
    expect(updated.slug).toBe('profile-school')
    expect(updated.contactEmail).toBe('office@profile.test')
    expect(updated.profileCompletedAt).not.toBeNull()

    const classRow = await schools.createClass(schoolId, 'basic_1')
    expect(classRow.level.label).toBe('Basic 1')
    const subject = await schools.createSubject(schoolId, 'Mathematics')
    await schools.createAssignment(schoolId, classRow.id, subject.id)

    const overview = await schools.getOverview(schoolId)
    expect(overview?.setup.steps).toEqual({
      profile: true,
      classes: true,
      subjects: true,
      assignments: true,
    })
    expect(overview?.setup.complete).toBe(true)
    expect(overview?.setup.completedAt).not.toBeNull()
  })

  it('enforces one class per level and preserves level order in class lists', async () => {
    const schoolId = await createSchool('Order School', 'order-school')
    await schools.createClass(schoolId, 'jhs_3')
    await schools.createClass(schoolId, 'creche')
    await schools.createClass(schoolId, 'basic_4')

    await expect(schools.createClass(schoolId, 'basic_4')).rejects.toMatchObject({
      status: 409,
      code: 'class_already_exists',
    })

    const classes = await schools.listClasses(schoolId)
    expect(classes.map((schoolClass) => schoolClass.level.label)).toEqual([
      'Creche',
      'Basic 4',
      'JHS 3',
    ])
  })

  it('manages sections and rejects duplicate names and cross-school parents', async () => {
    const schoolA = await createSchool('Section A', 'section-a')
    const schoolB = await createSchool('Section B', 'section-b')
    const classA = await schools.createClass(schoolA, 'basic_2')
    const classB = await schools.createClass(schoolB, 'basic_2')

    const section = await schools.createSection(schoolA, classA.id, 'A')
    expect(section.name).toBe('A')
    await expect(
      schools.createSection(schoolA, classA.id, 'a'),
    ).rejects.toMatchObject({ status: 409, code: 'section_name_taken' })

    await expect(
      schools.createSection(schoolA, classB.id, 'B'),
    ).rejects.toMatchObject({ status: 404, code: 'class_not_found' })

    await expect(
      pool.query(
        `INSERT INTO class_sections (school_id, class_id, name)
         VALUES ($1, $2, 'Cross')`,
        [schoolA, classB.id],
      ),
    ).rejects.toThrow(/foreign key/)
  })

  it('manages subjects, assignments, and blocks cross-school composite relationships', async () => {
    const schoolA = await createSchool('Assignment A', 'assignment-a')
    const schoolB = await createSchool('Assignment B', 'assignment-b')
    const classA = await schools.createClass(schoolA, 'basic_3')
    const classB = await schools.createClass(schoolB, 'basic_3')
    const subjectA = await schools.createSubject(schoolA, 'English')
    const subjectB = await schools.createSubject(schoolB, 'Science')

    await expect(
      schools.createSubject(schoolA, 'english'),
    ).rejects.toMatchObject({ status: 409, code: 'subject_name_taken' })

    const first = await schools.createAssignment(schoolA, classA.id, subjectA.id)
    expect(first.created).toBe(true)
    const second = await schools.createAssignment(schoolA, classA.id, subjectA.id)
    expect(second.created).toBe(false)

    await schools.updateAssignmentStatus(
      schoolA,
      classA.id,
      subjectA.id,
      'archived',
    )
    const reactivated = await schools.createAssignment(
      schoolA,
      classA.id,
      subjectA.id,
    )
    expect(reactivated.assignment.status).toBe('active')
    expect(reactivated.created).toBe(false)

    await expect(
      schools.createAssignment(schoolA, classB.id, subjectA.id),
    ).rejects.toMatchObject({ status: 404 })

    await expect(
      pool.query(
        `INSERT INTO class_subjects (school_id, class_id, subject_id)
         VALUES ($1, $2, $3)`,
        [schoolA, classA.id, subjectB.id],
      ),
    ).rejects.toThrow(/foreign key/)
  })

  it('stores a private logo key only on the school row and enforces the school prefix', async () => {
    const schoolId = await createSchool('Logo School', 'logo-school')
    const uploadId = randomUUID()
    const key = `school-logos/${schoolId}/${uploadId}.png`

    const result = await schools.setLogo(schoolId, key, 'image/png')
    expect(result.logo.key).toBe(key)
    expect(result.previousKey).toBeNull()
    expect((await schools.getSchool(schoolId))?.hasLogo).toBe(true)

    const fetched = await schools.getLogo(schoolId)
    expect(fetched?.key).toBe(key)

    const wrongSchool = await createSchool('Wrong Logo', 'wrong-logo')
    const wrongKey = `school-logos/${wrongSchool}/${randomUUID()}.png`
    await expect(
      pool.query('UPDATE schools SET logo_key = $1 WHERE id = $2', [
        wrongKey,
        schoolId,
      ]),
    ).rejects.toThrow(/check constraint/)

    const previous = await schools.clearLogo(schoolId)
    expect(previous).toBe(key)
    expect(await schools.getLogo(schoolId)).toBeNull()
  })

  it('keeps setup status as a milestone while current checklist counts follow archive state', async () => {
    const schoolId = await createSchool('Milestone School', 'milestone-school')
    await schools.updateProfile(schoolId, {
      contactEmail: 'office@milestone.test',
    })
    const schoolClass = await schools.createClass(schoolId, 'kg_1')
    const subject = await schools.createSubject(schoolId, 'Language')
    await schools.createAssignment(schoolId, schoolClass.id, subject.id)

    expect((await schools.getOverview(schoolId))?.setup.complete).toBe(true)
    const completedAt = (await schools.getOverview(schoolId))?.setup.completedAt
    expect(completedAt).not.toBeNull()

    await schools.updateClassStatus(schoolId, schoolClass.id, 'archived')
    const after = await schools.getOverview(schoolId)
    expect(after?.setup.complete).toBe(false)
    expect(after?.setup.completedAt).toEqual(completedAt)
    expect(after?.setup.counts.archivedClasses).toBe(1)
  })

  it('returns domain errors for missing child records without leaking another school', async () => {
    const schoolA = await createSchool('Missing A', 'missing-a')
    const schoolB = await createSchool('Missing B', 'missing-b')
    const classB = await schools.createClass(schoolB, 'jhs_1')

    await expect(
      schools.updateSection(schoolA, classB.id, randomUUID(), { name: 'X' }),
    ).rejects.toMatchObject({ status: 404, code: 'section_not_found' })
  })
})
