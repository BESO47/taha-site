/**
 * =====================================================================
 * Physics Hub — Bulk WhatsApp gateway client
 * ---------------------------------------------------------------------
 * Talks to the Node gateway in `server/` (whatsapp-web.js / Meta Cloud
 * API / relay). The gateway owns the WhatsApp session and the dispatch
 * queue, so a campaign keeps running even if the admin closes the tab —
 * the UI just polls the job for progress.
 *
 * Configuration (.env of the Vite app):
 *   VITE_WHATSAPP_GATEWAY_URL  default '/api/whatsapp' (proxied in dev)
 *   VITE_WHATSAPP_API_KEY      must match WA_API_KEY on the gateway
 * =====================================================================
 */

const RAW_BASE = (import.meta.env.VITE_WHATSAPP_GATEWAY_URL || '/api/whatsapp').trim()
export const GATEWAY_BASE = RAW_BASE.replace(/\/+$/, '')
const API_KEY = (import.meta.env.VITE_WHATSAPP_API_KEY || '').trim()

/** The gateway is always *reachable* in dev through the Vite proxy. */
export function isGatewayConfigured() {
  return Boolean(GATEWAY_BASE)
}

function headers() {
  const h = { 'Content-Type': 'application/json' }
  if (API_KEY) h['x-api-key'] = API_KEY
  return h
}

async function request(path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${GATEWAY_BASE}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const text = await res.text()
    let data = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch (_) {
      throw new Error(
        `Gateway returned a non-JSON response (${res.status}). ` +
        'Is the WhatsApp gateway running on the configured URL?'
      )
    }

    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Gateway responded with ${res.status}`)
    }
    return data
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Gateway request timed out')
    if (err instanceof TypeError) {
      throw new Error(
        'Cannot reach the WhatsApp gateway. Start it with `npm start` inside `server/` ' +
        '(see WHATSAPP_BULK_SETUP.md).'
      )
    }
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/** Health-check + provider info. Returns null when unreachable. */
export async function pingGateway() {
  try {
    return await request('/health', { timeoutMs: 6000 })
  } catch (_) {
    return null
  }
}

/**
 * Current session state.
 * @returns {Promise<{ready:boolean, status:string, qr:string|null, needsScan:boolean, me:object|null, provider:string, defaults:object}>}
 */
export function getGatewayStatus() {
  return request('/status', { timeoutMs: 10000 })
}

export function startSession() {
  return request('/session/start', { method: 'POST', timeoutMs: 60000 })
}

export function stopSession({ logout = false } = {}) {
  return request('/session/stop', { method: 'POST', body: { logout }, timeoutMs: 30000 })
}

/** Is this number registered on WhatsApp? */
export function checkNumber(phone) {
  return request('/check', { method: 'POST', body: { phone } })
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

export function sendSingleMessage({ phone, message, meta = {} }) {
  return request('/send', { method: 'POST', body: { phone, message, meta }, timeoutMs: 60000 })
}

/**
 * Queue a bulk campaign. Returns the job immediately (HTTP 202).
 */
export async function startBulkJob(messages, options = {}) {
  const payload = {
    messages: messages.map((m) => ({
      phone: m.phone,
      message: m.message,
      meta: {
        studentId: m.studentId || m.record?.student_id || null,
        studentName: m.studentName || m.record?.full_name || '',
        groupName: m.record?.group_name || '',
        recipientType: m.target || 'student',
      },
    })),
    ...options,
  }
  const { job } = await request('/bulk', { method: 'POST', body: payload, timeoutMs: 30000 })
  return job
}

export async function fetchJob(jobId) {
  const { job } = await request(`/jobs/${jobId}`)
  return job
}

export async function listJobs() {
  const { jobs } = await request('/jobs')
  return jobs
}

export async function pauseJob(jobId) {
  const { job } = await request(`/jobs/${jobId}/pause`, { method: 'POST' })
  return job
}

export async function resumeJob(jobId) {
  const { job } = await request(`/jobs/${jobId}/resume`, { method: 'POST' })
  return job
}

export async function cancelJob(jobId) {
  const { job } = await request(`/jobs/${jobId}/cancel`, { method: 'POST' })
  return job
}

const FINAL_STATES = ['completed', 'cancelled', 'failed']

/**
 * Poll a job until it finishes.
 *
 * @param {string}   jobId
 * @param {object}   options
 * @param {Function} options.onProgress  called with the job on every poll
 * @param {number}   options.intervalMs  poll interval (default 1500ms)
 * @param {AbortSignal} options.signal   stop polling (does NOT cancel the job)
 */
export async function waitForJob(jobId, { onProgress, intervalMs = 1500, signal } = {}) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) return fetchJob(jobId)
    const job = await fetchJob(jobId)
    onProgress?.(job)
    if (FINAL_STATES.includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
