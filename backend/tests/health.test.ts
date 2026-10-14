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

describe('unknown routes', () => {
  it('returns 404 for unmatched paths', async () => {
    const app = createApp()

    const response = await request(app).get('/api/does-not-exist')

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('Not found')
  })
})
