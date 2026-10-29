import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import {
  assertConnectedScratchTarget,
  assertScratchDatabaseUrl,
  type DatabaseTarget,
} from '../src/lib/scratchDatabase.ts'

type IdentityRow = {
  database: string
  current_user: string
  session_user: string
  rolsuper: boolean
  rolcreatedb: boolean
  rolcreaterole: boolean
  server_addr: string | null
}

const target: DatabaseTarget = {
  hostname: '127.0.0.1',
  port: 5432,
  database: 'gradely_scratch',
  username: 'gradely_scratch_app',
}

const baseRow: IdentityRow = {
  database: 'gradely_scratch',
  current_user: 'gradely_scratch_app',
  session_user: 'gradely_scratch_app',
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
  server_addr: '127.0.0.1',
}

function fakePool(row: IdentityRow | undefined): Pool {
  return {
    query: async () => ({ rows: row ? [row] : [] }),
  } as unknown as Pool
}

function withRow(overrides: Partial<IdentityRow>): Pool {
  return fakePool({ ...baseRow, ...overrides })
}

describe('assertConnectedScratchTarget server address handling', () => {
  it('accepts 127.0.0.1', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ server_addr: '127.0.0.1' }), target),
    ).resolves.toBeUndefined()
  })

  it('accepts 127.0.0.1/32 as returned by PostgreSQL inet text form', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ server_addr: '127.0.0.1/32' }), target),
    ).resolves.toBeUndefined()
  })

  it('accepts ::1', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ server_addr: '::1' }), target),
    ).resolves.toBeUndefined()
  })

  it('accepts ::1/128 as returned by PostgreSQL inet text form', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ server_addr: '::1/128' }), target),
    ).resolves.toBeUndefined()
  })

  it('rejects a non-loopback IPv4 server address', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ server_addr: '10.0.0.5' }), target),
    ).rejects.toThrow(/not loopback/)
  })

  it('rejects a non-loopback IPv6 server address', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ server_addr: '2001:db8::1' }), target),
    ).rejects.toThrow(/not loopback/)
  })

  it('rejects a wider CIDR network even when it contains a loopback address', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ server_addr: '127.0.0.1/24' }), target),
    ).rejects.toThrow(/not loopback/)
  })
})

describe('assertConnectedScratchTarget database and role checks', () => {
  it('rejects a connected database that does not match the target', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ database: 'postgres' }), target),
    ).rejects.toThrow(/does not match/)
  })

  it('rejects a connected role that does not match the target', async () => {
    await expect(
      assertConnectedScratchTarget(
        withRow({ current_user: 'other_role', session_user: 'other_role' }),
        target,
      ),
    ).rejects.toThrow(/does not match the requested database user/)
  })

  it('rejects a superuser', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ rolsuper: true }), target),
    ).rejects.toThrow(/superuser/)
  })

  it('rejects a CREATEDB role', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ rolcreatedb: true }), target),
    ).rejects.toThrow(/CREATEDB/)
  })

  it('rejects a CREATEROLE role', async () => {
    await expect(
      assertConnectedScratchTarget(withRow({ rolcreaterole: true }), target),
    ).rejects.toThrow(/CREATEROLE/)
  })

  it('rejects a missing identity row', async () => {
    await expect(
      assertConnectedScratchTarget(fakePool(undefined), target),
    ).rejects.toThrow(/Could not verify/)
  })
})

describe('assertScratchDatabaseUrl', () => {
  it('accepts an approved loopback scratch URL', () => {
    const parsed = assertScratchDatabaseUrl(
      'postgresql://gradely_scratch_app:secret@127.0.0.1:5432/gradely_scratch',
      { mode: 'test', nodeEnv: 'test', env: {} },
    )

    expect(parsed).toEqual(target)
  })

  it('rejects a remote host', () => {
    expect(() =>
      assertScratchDatabaseUrl(
        'postgresql://gradely_scratch_app:secret@10.0.0.5:5432/gradely_scratch',
        { mode: 'test', nodeEnv: 'test', env: {} },
      ),
    ).toThrow(/loopback host/)
  })

  it('rejects an unapproved database name', () => {
    expect(() =>
      assertScratchDatabaseUrl(
        'postgresql://gradely_scratch_app:secret@127.0.0.1:5432/gradely_production',
        { mode: 'test', nodeEnv: 'test', env: {} },
      ),
    ).toThrow(/approved scratch database name/)
  })

  it('rejects target-overriding query parameters', () => {
    expect(() =>
      assertScratchDatabaseUrl(
        'postgresql://gradely_scratch_app:secret@127.0.0.1:5432/gradely_scratch?host=evil.example',
        { mode: 'test', nodeEnv: 'test', env: {} },
      ),
    ).toThrow(/target-overriding/)
  })

  it('rejects production NODE_ENV', () => {
    expect(() =>
      assertScratchDatabaseUrl(
        'postgresql://gradely_scratch_app:secret@127.0.0.1:5432/gradely_scratch',
        { mode: 'test', nodeEnv: 'production', env: {} },
      ),
    ).toThrow(/NODE_ENV=production/)
  })
})
