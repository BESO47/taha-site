/**
 * Bulk payload & campaign-control regression tests.
 *
 * Regression coverage:
 *   1. A realistic 1 000-recipient Arabic campaign (~600 KB) is ACCEPTED —
 *      the old 256 KB JSON limit rejected it with HTTP 413 before any
 *      validation ran (proved live against the previous code).
 *   2. Payloads above maxRecipientsPerJob are still refused with 413.
 *   3. Pause / resume / cancel actually steer a running job.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app.js'

let server
let baseUrl

const post = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const getJob = async (id) => (await (await fetch(`${baseUrl}/api/whatsapp/jobs/${id}`)).json()).job

const pollUntil = async (id, states, attempts = 100) => {
  for (let i = 0; i < attempts; i += 1) {
    const job = await getJob(id)
    if (states.includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return getJob(id)
}

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

describe('bulk payload sizing (413 regression)', () => {
  it('accepts a 1000-recipient Arabic campaign that exceeded the old 256 KB limit', async () => {
    // ~600 bytes/message × 1000 recipients ≈ 0.6 MB (multi-byte Arabic)
    const arabic =
      'مرحباً {{student_name}} 👋 تقرير متابعتك في Physics Hub: حضور آخر حصة حاضر ✅، نسبة الحضور الكلية 85%، درجة آخر اختبار 18/20، آخر واجب 9/10. مع تحيات م. طه الصباغ ⚡'.repeat(2)
    const messages = Array.from({ length: 1000 }, (_, i) => ({
      phone: `010${String(10000000 + i).slice(0, 8)}`,
      message: arabic,
      meta: { studentName: `Student ${i}`, studentId: `s${i}` },
    }))
    const response = await post('/api/whatsapp/bulk', {
      messages,
      dryRun: true,
      delayMs: 0,
      jitterMs: 0,
      batchPauseMs: 0,
      maxRetries: 0,
    })
    assert.equal(response.status, 202, 'must NOT be 413 anymore')
    const { job } = await response.json()
    assert.equal(job.total, 1000)

    // Do not let the 1000-step dry run burn test time: cancel it.
    await post(`/api/whatsapp/jobs/${job.id}/cancel`, {})
    const finished = await pollUntil(job.id, ['cancelled', 'completed'])
    assert.ok(['cancelled', 'completed'].includes(finished.status))
  })

  it('still rejects recipient lists beyond maxRecipientsPerJob (1000)', async () => {
    const messages = Array.from({ length: 1001 }, (_, i) => ({
      phone: `010${String(10000000 + i).slice(0, 8)}`,
      message: 'hi',
    }))
    const response = await post('/api/whatsapp/bulk', { messages, dryRun: true })
    assert.equal(response.status, 413)
    assert.match((await response.json()).error, /Too many recipients/i)
  })
})

describe('campaign pause / resume / cancel controls', () => {
  it('pauses and cancels a slow campaign mid-flight', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      phone: `010${String(20000000 + i).slice(0, 8)}`,
      message: 'slow campaign message',
      meta: { studentName: `P${i}` },
    }))
    const response = await post('/api/whatsapp/bulk', {
      messages,
      dryRun: true,
      delayMs: 400,
      jitterMs: 0,
      batchPauseMs: 0,
      maxRetries: 0,
    })
    assert.equal(response.status, 202)
    const { job } = await response.json()

    // Pause — the job should stop advancing.
    await post(`/api/whatsapp/jobs/${job.id}/pause`, {})
    await new Promise((resolve) => setTimeout(resolve, 300))
    const pausedA = await getJob(job.id)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const pausedB = await getJob(job.id)
    assert.equal(pausedB.processed, pausedA.processed, 'no progress while paused')

    // Resume — progress continues.
    await post(`/api/whatsapp/jobs/${job.id}/resume`, {})
    await new Promise((resolve) => setTimeout(resolve, 500))
    const resumed = await getJob(job.id)
    assert.ok(resumed.processed > pausedB.processed, 'progress after resume')

    // Cancel — reaches a final state and stops.
    await post(`/api/whatsapp/jobs/${job.id}/cancel`, {})
    const finished = await pollUntil(job.id, ['cancelled', 'completed'])
    assert.equal(finished.status, 'cancelled')
    assert.ok(finished.processed < finished.total, 'stopped before the full list')
  })

  it('marks invalid numbers failed without consuming provider sends', async () => {
    const response = await post('/api/whatsapp/bulk', {
      messages: [
        { phone: '01312345678', message: 'bad prefix', meta: { studentName: 'Bad' } },
        { phone: '01012345678', message: 'good one', meta: { studentName: 'Good' } },
      ],
      dryRun: true,
      delayMs: 0,
      jitterMs: 0,
      batchPauseMs: 0,
      maxRetries: 0,
    })
    assert.equal(response.status, 202)
    const { job } = await response.json()
    const finished = await pollUntil(job.id, ['completed', 'failed'])
    assert.equal(finished.status, 'completed')
    assert.equal(finished.failed, 1)
    assert.equal(finished.sent, 1)
    const bad = finished.results.find((r) => r.name === 'Bad')
    assert.equal(bad.status, 'failed')
    assert.match(bad.error, /010|011|012|015|غير صالح/)
  })
})
