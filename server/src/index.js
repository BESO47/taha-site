/**
 * Physics Hub — Bulk WhatsApp gateway (HTTP API)
 *
 *   GET  /api/whatsapp/health
 *   GET  /api/whatsapp/status
 *   POST /api/whatsapp/session/start
 *   POST /api/whatsapp/session/stop      { logout?: boolean }
 *   POST /api/whatsapp/check             { phone }
 *   POST /api/whatsapp/send              { phone, message, meta? }
 *   POST /api/whatsapp/bulk              { messages[], delayMs?, jitterMs?, batchSize?, batchPauseMs?, dryRun? }
 *   GET  /api/whatsapp/jobs
 *   GET  /api/whatsapp/jobs/:id
 *   POST /api/whatsapp/jobs/:id/pause | /resume | /cancel
 *
 * Auth: send `x-api-key: <WA_API_KEY>` when WA_API_KEY is set.
 */
import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { log } from './logger.js'
import { getProvider, providerNames } from './providers/index.js'
import { validatePhone } from './phone.js'
import { createJob, getJob, listJobs, pauseJob, resumeJob, cancelJob } from './queue.js'

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '5mb' }))

app.use(
  cors({
    origin: config.allowedOrigins.includes('*') ? true : config.allowedOrigins,
    credentials: false,
    allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
  })
)

// ---------------------------------------------------------------- auth ----
const router = express.Router()

router.use((req, res, next) => {
  if (!config.apiKey) return next()
  if (req.path === '/health') return next()
  const provided = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (provided === config.apiKey) return next()
  return res.status(401).json({ ok: false, error: 'Invalid or missing API key' })
})

const wrap = (handler) => (req, res) => {
  Promise.resolve(handler(req, res)).catch((err) => {
    log.error(`${req.method} ${req.originalUrl} ->`, err.message)
    res.status(400).json({ ok: false, error: err.message })
  })
}

// -------------------------------------------------------------- routes ----
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'physics-hub-whatsapp-gateway',
    provider: config.provider,
    providers: providerNames,
    apiKeyRequired: Boolean(config.apiKey),
    uptimeSeconds: Math.round(process.uptime()),
  })
})

router.get('/status', wrap(async (req, res) => {
  const status = getProvider().getStatus()
  res.json({
    ok: true,
    ...status,
    defaults: {
      delayMs: config.defaultDelayMs,
      jitterMs: config.defaultJitterMs,
      batchSize: config.batchSize,
      batchPauseMs: config.batchPauseMs,
      maxRetries: config.maxRetries,
      maxRecipientsPerJob: config.maxRecipientsPerJob,
    },
  })
}))

router.post('/session/start', wrap(async (req, res) => {
  const status = await getProvider().start()
  res.json({ ok: true, ...status })
}))

router.post('/session/stop', wrap(async (req, res) => {
  const status = await getProvider().stop({ logout: Boolean(req.body?.logout) })
  res.json({ ok: true, ...status })
}))

router.post('/check', wrap(async (req, res) => {
  const { phone } = req.body || {}
  const check = validatePhone(phone, config.defaultCountryCode)
  if (!check.isValid) return res.json({ ok: true, valid: false, error: check.error })
  const resolved = await getProvider().checkNumber(check.normalized)
  res.json({ ok: true, valid: Boolean(resolved), normalized: check.normalized, chatId: resolved })
}))

router.post('/send', wrap(async (req, res) => {
  const { phone, message, meta } = req.body || {}
  if (!phone) throw new Error('phone is required')
  if (!String(message || '').trim()) throw new Error('message is required')

  const result = await getProvider().sendMessage(phone, message, meta || {})
  res.json({ ok: true, ...result })
}))

router.post('/bulk', wrap(async (req, res) => {
  const { messages, delayMs, jitterMs, batchSize, batchPauseMs, maxRetries, dryRun } = req.body || {}
  const job = createJob(messages, { delayMs, jitterMs, batchSize, batchPauseMs, maxRetries, dryRun })
  res.status(202).json({ ok: true, job })
}))

router.get('/jobs', wrap(async (req, res) => {
  res.json({ ok: true, jobs: listJobs() })
}))

router.get('/jobs/:id', wrap(async (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ ok: false, error: 'Job not found' })
  res.json({ ok: true, job })
}))

const control = { pause: pauseJob, resume: resumeJob, cancel: cancelJob }
for (const [action, fn] of Object.entries(control)) {
  router.post(`/jobs/:id/${action}`, wrap(async (req, res) => {
    const job = fn(req.params.id)
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found' })
    res.json({ ok: true, job })
  }))
}

app.use('/api/whatsapp', router)

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'physics-hub-whatsapp-gateway', docs: '/api/whatsapp/health' })
})

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }))

// ---------------------------------------------------------------- boot ----
const server = app.listen(config.port, config.host, async () => {
  log.info(`WhatsApp gateway listening on http://${config.host}:${config.port}`)
  log.info(`Provider: ${config.provider}${config.apiKey ? ' · API key required' : ' · no API key (dev mode)'}`)

  if (config.autoStart) {
    try {
      await getProvider().start()
    } catch (err) {
      log.warn(`Auto-start skipped: ${err.message}`)
    }
  } else {
    log.info('WA_AUTO_START=false — call POST /api/whatsapp/session/start to connect.')
  }
})

const shutdown = async (signal) => {
  log.info(`${signal} received — shutting down…`)
  server.close()
  try {
    await getProvider().stop()
  } catch (_) {}
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (err) => log.error('Unhandled rejection:', err))
