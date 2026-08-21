/**
 * Sequential bulk dispatch queue.
 *
 * Design goals (the previous implementation failed on all of them):
 *   - ONE message in flight at a time, with a randomized human-like delay.
 *   - A message is only counted as "sent" when the provider confirms it.
 *   - Automatic retries with backoff for transient failures.
 *   - Long pause after every N messages to stay under WhatsApp's radar.
 *   - Pause / resume / cancel that actually interrupt the running loop.
 *   - The job survives the HTTP request: the browser polls progress, so a
 *     closed tab or a refresh never kills a campaign.
 */
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { log } from './logger.js'
import { validatePhone } from './phone.js'
import { getProvider } from './providers/index.js'

/** jobId -> job */
const jobs = new Map()
const MAX_JOBS_KEPT = 50
let dispatchChain = Promise.resolve()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const maskPhone = (phone) => {
  const value = String(phone || '')
  return value.length > 4 ? `${'*'.repeat(value.length - 4)}${value.slice(-4)}` : '****'
}

function publicJob(job) {
  const { _control, ...rest } = job
  return rest
}

function pruneJobs() {
  if (jobs.size <= MAX_JOBS_KEPT) return
  const finished = [...jobs.values()]
    .filter((j) => ['completed', 'cancelled', 'failed'].includes(j.status))
    .sort((a, b) => new Date(a.finishedAt || 0) - new Date(b.finishedAt || 0))
  while (jobs.size > MAX_JOBS_KEPT && finished.length) {
    jobs.delete(finished.shift().id)
  }
}

/**
 * Create and start a bulk job.
 *
 * @param {Array<{phone:string, message:string, meta?:object}>} messages
 * @param {{delayMs?:number, jitterMs?:number, batchSize?:number, batchPauseMs?:number, maxRetries?:number, dryRun?:boolean}} options
 */
export function createJob(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array')
  }
  if (messages.length > config.maxRecipientsPerJob) {
    throw new Error(`Too many recipients (${messages.length}). Limit is ${config.maxRecipientsPerJob}.`)
  }
  const unfinishedJobs = [...jobs.values()].filter(
    (job) => !['completed', 'cancelled', 'failed'].includes(job.status)
  ).length
  if (unfinishedJobs >= config.maxQueuedJobs) {
    throw new Error(`The dispatch queue is full. Wait for a job to finish (limit: ${config.maxQueuedJobs}).`)
  }

  const finite = (value, fallback, max) => {
    const number = Number(value)
    return Number.isFinite(number) ? Math.min(max, Math.max(0, number)) : fallback
  }

  const job = {
    id: randomUUID(),
    status: 'queued',            // queued | running | paused | completed | cancelled | failed
    provider: config.provider,
    dryRun: Boolean(options.dryRun),
    total: messages.length,
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    percent: 0,
    current: null,               // { index, name, phone, status }
    delayMs: finite(options.delayMs, config.defaultDelayMs, 600_000),
    jitterMs: finite(options.jitterMs, config.defaultJitterMs, 600_000),
    batchSize: Math.max(1, finite(options.batchSize, config.batchSize, 1_000)),
    batchPauseMs: finite(options.batchPauseMs, config.batchPauseMs, 3_600_000),
    maxRetries: finite(options.maxRetries, config.maxRetries, 10),
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    results: messages.map((m, i) => ({
      index: i,
      name: m.meta?.studentName || m.name || '',
      studentId: m.meta?.studentId || null,
      recipientType: m.meta?.recipientType || 'student',
      phone: String(m.phone || ''),
      normalizedPhone: '',
      status: 'pending',        // pending | sent | failed | skipped
      attempts: 0,
      error: null,
      messageId: null,
      sentAt: null,
    })),
    _control: { pauseRequested: false, cancelRequested: false, resumeWaiters: [] },
  }

  jobs.set(job.id, job)
  pruneJobs()

  // Serialize jobs globally: multiple API requests must never create multiple
  // concurrent WhatsApp sends. The HTTP request still returns immediately.
  dispatchChain = dispatchChain
    .catch(() => {})
    .then(() => runJob(job, messages))
    .catch((err) => {
      job.status = 'failed'
      job.error = err.message
      job.finishedAt = new Date().toISOString()
      log.error(`Job ${job.id} crashed:`, err)
    })

  return publicJob(job)
}

/** Block while the job is paused; resolves immediately when running. */
async function waitWhilePaused(job) {
  while (job._control.pauseRequested && !job._control.cancelRequested) {
    job.status = 'paused'
    await new Promise((resolve) => job._control.resumeWaiters.push(resolve))
  }
  if (!job._control.cancelRequested) job.status = 'running'
}

/** Interruptible delay: returns false if the job was cancelled meanwhile. */
async function interruptibleDelay(job, ms) {
  const step = 250
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (job._control.cancelRequested) return false
    await waitWhilePaused(job)
    if (job._control.cancelRequested) return false
    await sleep(Math.min(step, Math.max(0, end - Date.now())))
  }
  return true
}

async function runJob(job, messages) {
  if (job._control.cancelRequested) {
    job.status = 'cancelled'
    job.finishedAt = new Date().toISOString()
    return
  }
  const provider = getProvider()

  // Make sure the transport is actually usable before burning through the
  // recipient list — the old implementation reported "sent" with no
  // transport configured at all.
  const status = provider.getStatus()
  if (!status.ready && !job.dryRun) {
    job.status = 'failed'
    job.error =
      `WhatsApp transport is not ready (provider: ${status.provider}, state: ${status.status}). ` +
      (status.needsScan ? 'Scan the QR code first.' : status.lastError || '')
    job.finishedAt = new Date().toISOString()
    log.error(`Job ${job.id} aborted: ${job.error}`)
    return
  }

  job.status = 'running'
  job.startedAt = new Date().toISOString()
  log.info(`Job ${job.id} started — ${job.total} recipient(s), delay ${job.delayMs}ms ±${job.jitterMs}ms`)

  for (let i = 0; i < messages.length; i++) {
    if (job._control.cancelRequested) break
    await waitWhilePaused(job)
    if (job._control.cancelRequested) break

    const item = messages[i]
    const result = job.results[i]
    job.current = { index: i, name: result.name, phone: result.phone, status: 'sending' }

    // ---- validation ------------------------------------------------
    const check = validatePhone(item.phone, config.defaultCountryCode)
    result.normalizedPhone = check.normalized
    if (!check.isValid) {
      result.status = 'failed'
      result.error = check.error
      job.failed += 1
      job.processed += 1
      job.percent = Math.round((job.processed / job.total) * 100)
      job.current = { index: i, name: result.name, phone: result.phone, status: 'failed' }
      continue
    }

    if (!String(item.message || '').trim()) {
      result.status = 'skipped'
      result.error = 'Empty message body'
      job.skipped += 1
      job.processed += 1
      job.percent = Math.round((job.processed / job.total) * 100)
      continue
    }

    // ---- send with retries -----------------------------------------
    let lastError = null
    for (let attempt = 0; attempt <= job.maxRetries; attempt++) {
      if (job._control.cancelRequested) break
      result.attempts = attempt + 1
      try {
        if (job.dryRun) {
          await sleep(120)
          result.messageId = `dry_${Date.now()}`
        } else {
          const sent = await provider.sendMessage(check.normalized, item.message, item.meta || {})
          result.messageId = sent?.id || null
        }
        result.status = 'sent'
        result.error = null
        result.sentAt = new Date().toISOString()
        job.sent += 1
        lastError = null
        break
      } catch (err) {
        lastError = err
        const permanent = /not registered|invalid|not allowed|forbidden/i.test(err.message || '')
        log.warn(`Job ${job.id} · ${maskPhone(check.normalized)} attempt ${attempt + 1} failed: ${err.message}`)
        if (permanent || attempt === job.maxRetries) break
        const backoff = config.retryBackoffMs * (attempt + 1)
        const ok = await interruptibleDelay(job, backoff)
        if (!ok) break
      }
    }

    if (lastError) {
      result.status = 'failed'
      result.error = lastError.message
      job.failed += 1
    }

    job.processed += 1
    job.percent = Math.round((job.processed / job.total) * 100)
    job.current = { index: i, name: result.name, phone: check.normalized, status: result.status }

    // ---- pacing -----------------------------------------------------
    const isLast = i === messages.length - 1
    if (!isLast && !job._control.cancelRequested) {
      const needsBatchPause =
        job.batchSize > 0 && job.batchPauseMs > 0 && (i + 1) % job.batchSize === 0

      if (needsBatchPause) {
        job.current = { index: i, name: result.name, phone: check.normalized, status: 'batch_pause' }
        log.info(`Job ${job.id} · batch of ${job.batchSize} done — cooling down ${job.batchPauseMs}ms`)
        const ok = await interruptibleDelay(job, job.batchPauseMs)
        if (!ok) break
      } else {
        const jitter = job.jitterMs > 0 ? Math.floor(Math.random() * job.jitterMs) : 0
        job.current = { index: i, name: result.name, phone: check.normalized, status: 'waiting' }
        const ok = await interruptibleDelay(job, job.delayMs + jitter)
        if (!ok) break
      }
    }
  }

  job.status = job._control.cancelRequested ? 'cancelled' : 'completed'
  job.finishedAt = new Date().toISOString()
  job.current = null
  log.info(`Job ${job.id} ${job.status} — sent ${job.sent}, failed ${job.failed}, skipped ${job.skipped}`)
}

export function getJob(id) {
  const job = jobs.get(id)
  return job ? publicJob(job) : null
}

export function listJobs() {
  return [...jobs.values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((j) => {
      const { results, ...summary } = publicJob(j)
      return summary
    })
}

export function pauseJob(id) {
  const job = jobs.get(id)
  if (!job) return null
  if (['completed', 'cancelled', 'failed'].includes(job.status)) return publicJob(job)
  job._control.pauseRequested = true
  job.status = 'paused'
  return publicJob(job)
}

export function resumeJob(id) {
  const job = jobs.get(id)
  if (!job) return null
  job._control.pauseRequested = false
  job.status = job.finishedAt ? job.status : 'running'
  job._control.resumeWaiters.splice(0).forEach((resolve) => resolve())
  return publicJob(job)
}

export function cancelJob(id) {
  const job = jobs.get(id)
  if (!job) return null
  job._control.cancelRequested = true
  job._control.pauseRequested = false
  // Surface the intent immediately; the loop flips it to 'cancelled' as
  // soon as the in-flight message finishes.
  if (!['completed', 'cancelled', 'failed'].includes(job.status)) job.status = 'cancelling'
  job._control.resumeWaiters.splice(0).forEach((resolve) => resolve())
  return publicJob(job)
}
