-- Gradely auth foundation (schools, users, memberships, sessions).
--
-- Retention / deletion behavior:
--   * Deleting a school cascades to its school_memberships only.
--   * Deleting a user cascades to their school_memberships and sessions.
--   * Sessions are revoked (revoked_at) rather than deleted on logout, so
--     they can be audited; expired/revoked rows can be purged later by a
--     cleanup job (not yet built). No plaintext passwords or secrets are
--     stored — only scrypt password hashes and SHA-256 session-token hashes.
--
-- Notes:
--   * Roles/statuses use text + CHECK (not enum types) so future migrations
--     can add values with plain ALTER TABLE inside the runner's transaction.
--   * updated_at is maintained by the set_updated_at() trigger.
--   * Platform-level authorization is the users.is_platform_admin flag and is
--     deliberately separate from school_memberships.role.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Schools
-- ---------------------------------------------------------------------------
CREATE TABLE schools (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER schools_set_updated_at
  BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Normalized to lowercase by the application and enforced here.
  email            text NOT NULL UNIQUE
                     CHECK (email = lower(email)
                            AND length(email) BETWEEN 3 AND 254
                            AND position('@' in email) BETWEEN 2 AND 253),
  -- scrypt hash in the format produced by src/lib/passwords.ts
  -- ("scrypt$N$r$p$salt$hash"). Never plaintext.
  password_hash    text NOT NULL CHECK (length(password_hash) > 20),
  display_name     text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  -- Platform administrator flag: platform-level power, NOT a school role.
  is_platform_admin boolean NOT NULL DEFAULT false,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- School memberships (school-scoped roles)
-- ---------------------------------------------------------------------------
CREATE TABLE school_memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('school_admin', 'teacher')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id)
);

CREATE INDEX school_memberships_user_id_idx
  ON school_memberships (user_id)
  WHERE status = 'active';

CREATE TRIGGER school_memberships_set_updated_at
  BEFORE UPDATE ON school_memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Sessions (opaque server-side tokens; only SHA-256 hashes are stored)
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
