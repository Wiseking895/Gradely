import { isIP } from 'node:net'
import type { Pool } from 'pg'

/**
 * Shared safety checks for destructive scratch-database work.
 *
 * Every database URL that may be reset, migrated, or otherwise written to must
 * pass through this module first. The rules are intentionally strict:
 *
 *  - the caller must declare an explicit scratch/test execution mode;
 *  - production (`NODE_ENV=production`) is always rejected;
 *  - only loopback hosts are accepted;
 *  - the database name must match an approved scratch pattern exactly;
 *  - target-overriding libpq query parameters are rejected;
 *  - a target that is also configured as DATABASE_URL, DIRECT_URL, or
 *    MIGRATION_DATABASE_URL is rejected unless that URL is itself a valid
 *    scratch target.
 *
 * Error messages and diagnostics never include passwords or full URLs.
 */

export type DatabaseTarget = {
  hostname: string
  port: number
  database: string
  username: string
}

export type ScratchTarget = DatabaseTarget

export type ScratchExecutionMode = 'scratch' | 'test'

export type ScratchValidationOptions = {
  mode: ScratchExecutionMode
  nodeEnv?: string
  env?: NodeJS.ProcessEnv
  /** Set false only when the caller has already performed the comparison. */
  checkKnownProductionUrls?: boolean
}

const DEFAULT_POSTGRES_PORT = 5432

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

const FORBIDDEN_QUERY_PARAMETERS = new Set([
  'host',
  'hostaddr',
  'port',
  'dbname',
  'user',
  'password',
  'service',
  'options',
])

/** `gradely_scratch`, `gradely_scratch_ci_1`, `gradely_test`, `gradely_test_2`. */
const SCRATCH_DATABASE_PATTERN = /^gradely_(scratch|test)(_[a-z0-9_]+)?$/

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
}

/**
 * Normalizes the value returned for the connected server address. PostgreSQL's
 * `inet` text form can include a host prefix (for example `127.0.0.1/32`).
 * Only a single-host prefix is stripped: `/32` for IPv4 and `/128` for IPv6.
 * Wider networks are left intact so they fail the loopback check.
 */
function normalizeServerAddress(address: string): string {
  const normalized = normalizeHostname(address)
  const slash = normalized.lastIndexOf('/')
  if (slash === -1) {
    return normalized
  }

  const host = normalized.slice(0, slash)
  const prefix = normalized.slice(slash + 1)
  const version = isIP(host)

  if (
    (version === 4 && prefix === '32') ||
    (version === 6 && prefix === '128')
  ) {
    return host
  }

  return normalized
}

function decodeValue(value: string, label: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error(`${label} contains invalid percent-encoding`)
  }
}

function parsePostgresUrl(raw: string, label: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} is not a valid PostgreSQL connection URL`)
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${label} must use the postgres:// or postgresql:// protocol`)
  }

  if (url.hash) {
    throw new Error(`${label} must not contain a URL fragment`)
  }

  return url
}

function portOf(url: URL): number {
  return url.port ? Number(url.port) : DEFAULT_POSTGRES_PORT
}

function databaseOf(url: URL, label: string): string {
  return decodeValue(url.pathname.replace(/^\/+/, ''), label)
}

function usernameOf(url: URL, label: string): string {
  return decodeValue(url.username, label)
}

/**
 * Parses any PostgreSQL URL into a target without applying scratch policy.
 * Used for safe diagnostics and for comparing against known configured URLs.
 */
export function parseDatabaseTarget(
  raw: string,
  label = 'Database URL',
): DatabaseTarget {
  const url = parsePostgresUrl(raw.trim(), label)
  assertNoTargetOverrides(url, label)

  return {
    hostname: normalizeHostname(url.hostname),
    port: portOf(url),
    database: databaseOf(url, label),
    username: usernameOf(url, label),
  }
}

export function sameDatabaseTarget(a: DatabaseTarget, b: DatabaseTarget): boolean {
  return (
    a.hostname === b.hostname &&
    a.port === b.port &&
    a.database === b.database
  )
}

function isScratchDatabaseTarget(target: DatabaseTarget): boolean {
  return (
    LOOPBACK_HOSTS.has(target.hostname) &&
    SCRATCH_DATABASE_PATTERN.test(target.database)
  )
}

function assertScratchTarget(target: DatabaseTarget, label: string): void {
  if (!target.hostname) {
    throw new Error(`${label} must include a host`)
  }

  if (target.hostname.includes(',')) {
    throw new Error(`${label} must contain exactly one host`)
  }

  if (!LOOPBACK_HOSTS.has(target.hostname)) {
    throw new Error(
      `${label} must use a loopback host (127.0.0.1 or ::1); refusing "${target.hostname}"`,
    )
  }

  if (!SCRATCH_DATABASE_PATTERN.test(target.database)) {
    throw new Error(
      `${label} must use an approved scratch database name such as "gradely_scratch"`,
    )
  }

  if (!target.username) {
    throw new Error(`${label} must include a database user`)
  }
}

function assertNoTargetOverrides(url: URL, label: string): void {
  for (const key of url.searchParams.keys()) {
    if (FORBIDDEN_QUERY_PARAMETERS.has(key.toLowerCase())) {
      throw new Error(
        `${label} must not use the target-overriding query parameter "${key}"`,
      )
    }
  }
}

/**
 * Validates a URL before any connection is opened or destructive SQL is run.
 * Throws a non-secret error when the target is not an approved scratch target.
 */
export function assertScratchDatabaseUrl(
  raw: string | undefined,
  options: ScratchValidationOptions,
): ScratchTarget {
  if (options.mode !== 'scratch' && options.mode !== 'test') {
    throw new Error('An explicit scratch or test execution mode is required')
  }

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV
  if (nodeEnv === 'production') {
    throw new Error('Refusing scratch database work with NODE_ENV=production')
  }

  if (options.mode === 'test' && nodeEnv !== 'test') {
    throw new Error(
      'Database integration tests require NODE_ENV=test; refusing destructive test setup',
    )
  }

  if (!raw || raw.trim() === '') {
    throw new Error('A scratch database URL is required')
  }

  const target = parseDatabaseTarget(raw, 'Scratch database URL')
  assertScratchTarget(target, 'Scratch database URL')

  if (options.checkKnownProductionUrls !== false) {
    const env = options.env ?? process.env
    const knownUrls: Array<[string, string | undefined]> = [
      ['DATABASE_URL', env.DATABASE_URL],
      ['DIRECT_URL', env.DIRECT_URL],
      ['MIGRATION_DATABASE_URL', env.MIGRATION_DATABASE_URL],
    ]

    for (const [label, value] of knownUrls) {
      if (!value || value.trim() === '') {
        continue
      }

      let otherTarget: DatabaseTarget
      try {
        otherTarget = parseDatabaseTarget(value)
      } catch {
        throw new Error(
          `${label} is set but is not a valid PostgreSQL connection URL; refusing to continue`,
        )
      }

      if (sameDatabaseTarget(target, otherTarget) && !isScratchDatabaseTarget(otherTarget)) {
        throw new Error(
          `Scratch database URL must not point at the same target as ${label}`,
        )
      }
    }
  }

  return target
}

/** True when the URL is parseable and uses a loopback host. */
export function isLoopbackDatabaseUrl(raw: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(parseDatabaseTarget(raw).hostname)
  } catch {
    return false
  }
}

/** Safe diagnostic text: host, port, database, and user only. */
export function describeDatabaseTarget(target: DatabaseTarget): string {
  return [
    `host=${target.hostname || '(none)'}`,
    `port=${target.port}`,
    `db=${target.database || '(none)'}`,
    `user=${target.username || '(none)'}`,
  ].join(' ')
}

type ConnectionIdentityRow = {
  database: string
  current_user: string
  session_user: string
  rolsuper: boolean
  rolcreatedb: boolean
  rolcreaterole: boolean
  server_addr: string | null
}

export type ConnectedTargetOptions = {
  requireNonSuperuser?: boolean
  requireLoopbackServer?: boolean
}

/**
 * Verifies the database and role actually reached by the connection. This must
 * run before destructive SQL. A null `inet_server_addr()` is accepted as a
 * local Unix-domain socket; TCP connections must report a loopback address.
 */
export async function assertConnectedDatabaseTarget(
  pool: Pool,
  target: DatabaseTarget,
  options: ConnectedTargetOptions = {},
): Promise<void> {
  const result = await pool.query<ConnectionIdentityRow>(`
    SELECT current_database() AS database,
           current_user AS current_user,
           session_user AS session_user,
           r.rolsuper,
           r.rolcreatedb,
           r.rolcreaterole,
           host(inet_server_addr()) AS server_addr
    FROM pg_roles r
    WHERE r.rolname = current_user
  `)

  const row = result.rows[0]
  if (!row) {
    throw new Error('Could not verify the connected database identity')
  }

  if (row.database !== target.database) {
    throw new Error(
      `Connected database "${row.database}" does not match the requested database "${target.database}"`,
    )
  }

  if (
    target.username &&
    (row.current_user !== target.username || row.session_user !== target.username)
  ) {
    throw new Error('Connected role does not match the requested database user')
  }

  if (
    options.requireNonSuperuser &&
    (row.rolsuper || row.rolcreatedb || row.rolcreaterole)
  ) {
    throw new Error(
      'Refusing destructive scratch work with a superuser, CREATEDB, or CREATEROLE role',
    )
  }

  if (options.requireLoopbackServer && row.server_addr !== null) {
    const serverAddress = normalizeServerAddress(row.server_addr)
    if (!LOOPBACK_HOSTS.has(serverAddress)) {
      throw new Error(
        `Refusing scratch work: the connected server address "${serverAddress}" is not loopback`,
      )
    }
  }
}

/** Stricter wrapper for destructive scratch/test operations. */
export async function assertConnectedScratchTarget(
  pool: Pool,
  target: ScratchTarget,
): Promise<void> {
  await assertConnectedDatabaseTarget(pool, target, {
    requireNonSuperuser: true,
    requireLoopbackServer: true,
  })
}
