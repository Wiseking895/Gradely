import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'

describe('GET /api/health', () => {
  it('returns 200 ok without requiring a database connection', async () => {
    const app = createApp()

    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
    expect(response.body.service).toBe('gradely-api')
  })
})

describe('GET /api/health/db', () => {
  // Tests run without DATABASE_URL (no .env loading in vitest), so the
  // database health check must fail safe: 503, no error details leaked.
  it('returns a safe 503 when no database is configured', async () => {
    const app = createApp()

    const response = await request(app).get('/api/health/db')

    expect(response.status).toBe(503)
    expect(response.body).toEqual({ status: 'unavailable', database: 'down' })
    expect(JSON.stringify(response.body)).not.toMatch(
      /postgres|ECONNREFUSED|password|DATABASE_URL/i,
    )
  })
})

describe('unknown routes', () => {
  it('returns 404 for unmatched paths', async () => {
    const app = createApp()

    const response = await request(app).get('/api/does-not-exist')

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('Not found')
  })
})
