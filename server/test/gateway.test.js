import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app.js'
import { HttpError } from '../src/auth.js'
import { normalizePhone, validatePhone } from '../src/phone.js'

let server
let baseUrl

before(async () => {
  const app = createApp({ authenticate: async () => ({ id: 'test-admin', type: 'test' }) })
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
})

describe('phone validation', () => {
  it('normalizes Egyptian local numbers', () => {
    assert.equal(normalizePhone('010 1234 5678'), '201012345678')
    assert.equal(validatePhone('01012345678').isValid, true)
  })

  it('rejects malformed numbers', () => {
    assert.equal(validatePhone('123').isValid, false)
    assert.equal(validatePhone('').isValid, false)
  })
})

describe('gateway HTTP API', () => {
  it('exposes a minimal health endpoint with security headers', async () => {
    const response = await fetch(`${baseUrl}/api/whatsapp/health`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    const data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.service, 'physics-hub-whatsapp-gateway')
  })

  it('protects non-health routes with backend authentication', async () => {
    const protectedApp = createApp({ authenticate: async () => { throw new HttpError(401, 'Authentication required') } })
    const protectedServer = await new Promise((resolve) => {
      const instance = protectedApp.listen(0, '127.0.0.1', () => resolve(instance))
    })
    try {
      const response = await fetch(`http://127.0.0.1:${protectedServer.address().port}/api/whatsapp/status`)
      assert.equal(response.status, 401)
      assert.equal((await response.json()).ok, false)
    } finally {
      await new Promise((resolve) => protectedServer.close(resolve))
    }
  })

  it('rejects invalid send payloads before a provider call', async () => {
    const response = await fetch(`${baseUrl}/api/whatsapp/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '01012345678', message: '' }),
    })
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /message is required/)
  })

  it('runs a validated dry-run bulk job to completion', async () => {
    const createdResponse = await fetch(`${baseUrl}/api/whatsapp/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ phone: '01012345678', message: 'Test message', meta: { studentName: 'Test' } }],
        delayMs: 0,
        jitterMs: 0,
        batchPauseMs: 0,
        dryRun: true,
      }),
    })
    assert.equal(createdResponse.status, 202)
    const created = await createdResponse.json()
    assert.ok(created.job.id)

    let job
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/whatsapp/jobs/${created.job.id}`)
      job = (await response.json()).job
      if (['completed', 'failed', 'cancelled'].includes(job.status)) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(job.status, 'completed')
    assert.equal(job.sent, 1)
    assert.equal(job.failed, 0)
  })

  it('returns JSON for malformed request bodies', async () => {
    const response = await fetch(`${baseUrl}/api/whatsapp/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    })
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.equal(body.ok, false)
    assert.equal(typeof body.error, 'string')
  })
})
