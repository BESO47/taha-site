import express from 'express'
import cors from 'cors'
import { config, isSupabaseAuthConfigured } from './config.js'
import { authenticateAdmin, HttpError } from './auth.js'
import { log } from './logger.js'
import { getProvider, providerNames } from './providers/index.js'
import { validatePhone } from './phone.js'
import { createJob, getJob, listJobs, pauseJob, resumeJob, cancelJob } from './queue.js'
import { validateBulkPayload, validateSinglePayload } from './validation.js'

function securityHeaders(_req, res, next) {
  res.set({
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  })
  next()
}

function createRateLimiter() {
  const clients = new Map()
  let requestsSinceCleanup = 0
  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip || req.socket?.remoteAddress || 'unknown'
    const current = clients.get(key)
    const state = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + config.rateLimit.windowMs }
      : current
    state.count += 1
    clients.set(key, state)

    res.set('RateLimit-Limit', String(config.rateLimit.maxRequests))
    res.set('RateLimit-Remaining', String(Math.max(0, config.rateLimit.maxRequests - state.count)))
    res.set('RateLimit-Reset', String(Math.ceil(state.resetAt / 1_000)))

    requestsSinceCleanup += 1
    if (requestsSinceCleanup >= 500) {
      requestsSinceCleanup = 0
      for (const [client, entry] of clients) if (entry.resetAt <= now) clients.delete(client)
    }

    if (state.count > config.rateLimit.maxRequests) {
      res.set('Retry-After', String(Math.ceil((state.resetAt - now) / 1_000)))
      return res.status(429).json({ ok: false, error: 'Too many requests' })
    }
    next()
  }
}

function corsOptions(req, callback) {
  const origin = req.get('origin')
  const isAllowed = !origin || config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)
  callback(null, {
    origin: isAllowed ? origin || false : false,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
    maxAge: 600,
  })
}

const wrap = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next)
}

export function createApp({ authenticate = authenticateAdmin } = {}) {
  const app = express()
  app.disable('x-powered-by')
  if (config.trustProxy) app.set('trust proxy', 1)
  app.use(securityHeaders)
  app.use(createRateLimiter())
  app.use(cors(corsOptions))
  app.use(express.json({ limit: '256kb', strict: true }))

  const router = express.Router()

  // Liveness is intentionally public and contains no session or credential data.
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'physics-hub-whatsapp-gateway',
      provider: config.provider,
      providers: providerNames,
      authentication: {
        apiKey: Boolean(config.apiKey),
        supabase: isSupabaseAuthConfigured(),
        insecureLocal: config.allowInsecureLocal && !config.isProduction,
      },
      uptimeSeconds: Math.round(process.uptime()),
    })
  })

  router.use(wrap(async (req, _res, next) => {
    req.principal = await authenticate(req)
    next()
  }))

  router.get('/status', wrap(async (_req, res) => {
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

  router.post('/session/start', wrap(async (_req, res) => {
    const status = await getProvider().start()
    res.json({ ok: true, ...status })
  }))

  router.post('/session/stop', wrap(async (req, res) => {
    const status = await getProvider().stop({ logout: req.body?.logout === true })
    res.json({ ok: true, ...status })
  }))

  router.post('/check', wrap(async (req, res) => {
    const phone = String(req.body?.phone || '').slice(0, 40)
    const check = validatePhone(phone, config.defaultCountryCode)
    if (!check.isValid) return res.json({ ok: true, valid: false, error: check.error })
    const resolved = await getProvider().checkNumber(check.normalized)
    res.json({ ok: true, valid: Boolean(resolved), normalized: check.normalized, chatId: resolved })
  }))

  router.post('/send', wrap(async (req, res) => {
    const payload = validateSinglePayload(req.body)
    const result = await getProvider().sendMessage(payload.phone, payload.message, payload.meta)
    res.json({ ok: true, ...result })
  }))

  router.post('/bulk', wrap(async (req, res) => {
    const { messages, options } = validateBulkPayload(req.body, config)
    const job = createJob(messages, options)
    res.status(202).json({ ok: true, job })
  }))

  router.get('/jobs', wrap(async (_req, res) => {
    res.json({ ok: true, jobs: listJobs() })
  }))

  router.get('/jobs/:id', wrap(async (req, res) => {
    const job = getJob(req.params.id)
    if (!job) throw new HttpError(404, 'Job not found')
    res.json({ ok: true, job })
  }))

  const controls = { pause: pauseJob, resume: resumeJob, cancel: cancelJob }
  for (const [action, control] of Object.entries(controls)) {
    router.post(`/jobs/:id/${action}`, wrap(async (req, res) => {
      const job = control(req.params.id)
      if (!job) throw new HttpError(404, 'Job not found')
      res.json({ ok: true, job })
    }))
  }

  app.use('/api/whatsapp', router)
  app.get('/', (_req, res) => res.json({ ok: true, service: 'physics-hub-whatsapp-gateway' }))
  app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }))

  app.use((error, req, res, _next) => {
    const bodyParseError = error?.type === 'entity.parse.failed'
    const tooLarge = error?.type === 'entity.too.large'
    const status = tooLarge ? 413 : bodyParseError ? 400 : error.statusCode || 500
    const publicMessage = status >= 500 ? 'Internal server error' : error.message
    if (status >= 500) log.error(`${req.method} ${req.originalUrl} ->`, error.message)
    res.status(status).json({ ok: false, error: publicMessage })
  })

  return app
}
