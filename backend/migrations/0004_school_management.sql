-- Gradely Phase B: school profile, classes, sections, subjects, and
-- class-subject assignments.
--
-- Design notes:
--   * class_levels is the shared, immutable 14-level catalogue. Schools do
--     not own these rows; they create school_classes instances that reference
--     a level by its stable code.
--   * Every school-owned table carries school_id. Child tables use composite
--     (id, school_id) foreign keys so a row in school A can never reference a
--     parent in school B, even if application authorization is bypassed.
--   * archive is soft deletion: status = 'archived'. No hard-delete endpoint
--     is added for classes, sections, subjects, or assignments.
--   * The school logo is tenant data and is deliberately separate from the
--     Gradely brand asset. logo_key is an internal R2 object key and must never
--     be returned by an API. The CHECK below ties every key to its school's
--     own school-logos/{id}/ prefix.
--   * 0004 depends on 0001 (schools, set_updated_at) and 0003 (the current
--     school/membership status lifecycle).

-- ---------------------------------------------------------------------------
-- School profile, setup status, and private logo reference
-- ---------------------------------------------------------------------------
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS logo_key text,
  ADD COLUMN IF NOT EXISTS logo_content_type text,
  ADD COLUMN IF NOT EXISTS logo_updated_at timestamptz;

ALTER TABLE schools
  ADD CONSTRAINT schools_contact_email_check
  CHECK (
    contact_email IS NULL OR (
      contact_email = lower(contact_email)
      AND length(contact_email) BETWEEN 3 AND 254
      AND position('@' in contact_email) BETWEEN 2 AND 253
    )
  );

ALTER TABLE schools
  ADD CONSTRAINT schools_phone_check
  CHECK (phone IS NULL OR length(btrim(phone)) BETWEEN 3 AND 40);

ALTER TABLE schools
  ADD CONSTRAINT schools_address_check
  CHECK (address IS NULL OR length(btrim(address)) BETWEEN 1 AND 300);

ALTER TABLE schools
  ADD CONSTRAINT schools_logo_key_prefix_check
  CHECK (
    logo_key IS NULL OR (
      logo_key LIKE 'school-logos/' || id::text || '/%'
      AND logo_key ~ '^school-logos/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
    )
  );

ALTER TABLE schools
  ADD CONSTRAINT schools_logo_consistency_check
  CHECK (
    (logo_key IS NULL AND logo_content_type IS NULL AND logo_updated_at IS NULL)
    OR
    (
      logo_key IS NOT NULL
      AND logo_content_type IN ('image/png', 'image/jpeg', 'image/webp')
      AND logo_updated_at IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- Global class-level catalogue (exactly 14 rows, seeded below)
-- ---------------------------------------------------------------------------
CREATE TABLE class_levels (
  code         text PRIMARY KEY
                 CHECK (code ~ '^[a-z0-9_]+$'),
  display_name text NOT NULL UNIQUE
                 CHECK (length(btrim(display_name)) BETWEEN 2 AND 20),
  sort_order   smallint NOT NULL UNIQUE
                 CHECK (sort_order BETWEEN 1 AND 14),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER class_levels_set_updated_at
  BEFORE UPDATE ON class_levels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO class_levels (code, display_name, sort_order)
VALUES
  ('creche',    'Creche',    1),
  ('nursery_1', 'Nursery 1', 2),
  ('nursery_2', 'Nursery 2', 3),
  ('kg_1',      'KG 1',      4),
  ('kg_2',      'KG 2',      5),
  ('basic_1',   'Basic 1',   6),
  ('basic_2',   'Basic 2',   7),
  ('basic_3',   'Basic 3',   8),
  ('basic_4',   'Basic 4',   9),
  ('basic_5',   'Basic 5',   10),
  ('basic_6',   'Basic 6',   11),
  ('jhs_1',     'JHS 1',     12),
  ('jhs_2',     'JHS 2',     13),
  ('jhs_3',     'JHS 3',     14)
ON CONFLICT (code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- School-owned classes: exactly one class instance per level per school
-- ---------------------------------------------------------------------------
CREATE TABLE school_classes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_level_code text NOT NULL REFERENCES class_levels(code) ON DELETE RESTRICT,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'archived')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, class_level_code),
  -- Referenced by composite child FKs. The pair is unique because id is the PK,
  -- but PostgreSQL requires an explicit unique constraint for the pair.
  UNIQUE (id, school_id)
);

CREATE INDEX school_classes_school_status_idx
  ON school_classes (school_id, status);

CREATE TRIGGER school_classes_set_updated_at
  BEFORE UPDATE ON school_classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Sections (arms/streams) within a school class
-- ---------------------------------------------------------------------------
CREATE TABLE class_sections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL,
  class_id   uuid NOT NULL,
  name       text NOT NULL
               CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 40),
  status     text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  CONSTRAINT class_sections_class_school_fk
    FOREIGN KEY (class_id, school_id)
    REFERENCES school_classes(id, school_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX class_sections_class_name_unique
  ON class_sections (class_id, lower(name));

CREATE INDEX class_sections_school_class_status_idx
  ON class_sections (school_id, class_id, status);

CREATE TRIGGER class_sections_set_updated_at
  BEFORE UPDATE ON class_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- School-owned subjects
-- ---------------------------------------------------------------------------
CREATE TABLE subjects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       text NOT NULL
               CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 120),
  status     text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id)
);

CREATE UNIQUE INDEX subjects_school_name_unique
  ON subjects (school_id, lower(name));

CREATE INDEX subjects_school_status_idx
  ON subjects (school_id, status);

CREATE TRIGGER subjects_set_updated_at
  BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Class-subject assignments
-- ---------------------------------------------------------------------------
CREATE TABLE class_subjects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL,
  class_id   uuid NOT NULL,
  subject_id uuid NOT NULL,
  status     text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, subject_id),
  CONSTRAINT class_subjects_class_school_fk
    FOREIGN KEY (class_id, school_id)
    REFERENCES school_classes(id, school_id)
    ON DELETE CASCADE,
  CONSTRAINT class_subjects_subject_school_fk
    FOREIGN KEY (subject_id, school_id)
    REFERENCES subjects(id, school_id)
    ON DELETE CASCADE
);

CREATE INDEX class_subjects_school_class_status_idx
  ON class_subjects (school_id, class_id, status);

CREATE INDEX class_subjects_school_subject_status_idx
  ON class_subjects (school_id, subject_id, status);

CREATE TRIGGER class_subjects_set_updated_at
  BEFORE UPDATE ON class_subjects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
