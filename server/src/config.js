/** Centralized, validated gateway configuration. */
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase()

const integer = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const bool = (value, fallback = false) => {
  if (value == null || value === '') return fallback
  return String(value).toLowerCase() === 'true'
}

const list = (value, fallback = []) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .concat(fallback)
  .filter((item, index, all) => all.indexOf(item) === index)

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',

  // HTTP and authentication. API keys are for trusted server-to-server use;
  // browser users authenticate with a Supabase access token.
  port: integer(process.env.PORT, 4000, { min: 1, max: 65535 }),
  host: process.env.HOST || '0.0.0.0',
  trustProxy: bool(process.env.TRUST_PROXY, false),
  apiKey: (process.env.WA_API_KEY || '').trim(),
  allowInsecureLocal: bool(process.env.WA_ALLOW_INSECURE_LOCAL, false),
  allowedOrigins: list(process.env.WA_ALLOWED_ORIGINS, nodeEnv === 'development'
    ? ['http://localhost:5173', 'http://127.0.0.1:5173']
    : []),
  supabase: {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    anonKey: (process.env.SUPABASE_ANON_KEY || '').trim(),
    authCacheMs: integer(process.env.WA_AUTH_CACHE_MS, 30_000, { min: 0, max: 300_000 }),
  },
  rateLimit: {
    windowMs: integer(process.env.WA_RATE_LIMIT_WINDOW_MS, 60_000, { min: 1_000, max: 3_600_000 }),
    maxRequests: integer(process.env.WA_RATE_LIMIT_MAX, 120, { min: 10, max: 10_000 }),
  },

  // Provider: whatsapp-web (optional) | cloud-api | webhook | mock.
  provider: (process.env.WA_PROVIDER || 'mock').trim(),
  sessionDir: process.env.WA_SESSION_DIR || path.resolve(__dirname, '../.wwebjs_auth'),
  sessionId: (process.env.WA_SESSION_ID || 'physics-hub').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80),
  chromiumPath: process.env.WA_CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  headless: bool(process.env.WA_HEADLESS, true),
  autoStart: bool(process.env.WA_AUTO_START, true),
  printQrInTerminal: bool(process.env.WA_PRINT_QR, false),

  cloudApi: {
    token: process.env.WA_CLOUD_TOKEN || '',
    phoneNumberId: process.env.WA_CLOUD_PHONE_NUMBER_ID || '',
    apiVersion: process.env.WA_CLOUD_API_VERSION || 'v20.0',
    templateName: process.env.WA_CLOUD_TEMPLATE || '',
    templateLang: process.env.WA_CLOUD_TEMPLATE_LANG || 'ar',
  },
  webhook: {
    url: process.env.WA_WEBHOOK_URL || '',
    method: (process.env.WA_WEBHOOK_METHOD || 'POST').toUpperCase(),
    authHeader: process.env.WA_WEBHOOK_AUTH_HEADER || '',
    authValue: process.env.WA_WEBHOOK_AUTH_VALUE || '',
    timeoutMs: integer(process.env.WA_WEBHOOK_TIMEOUT_MS, 20_000, { min: 1_000, max: 120_000 }),
  },

  // Dispatch safety.
  defaultDelayMs: integer(process.env.WA_DEFAULT_DELAY_MS, 4_000, { max: 600_000 }),
  defaultJitterMs: integer(process.env.WA_DEFAULT_JITTER_MS, 2_000, { max: 600_000 }),
  maxRetries: integer(process.env.WA_MAX_RETRIES, 2, { max: 10 }),
  retryBackoffMs: integer(process.env.WA_RETRY_BACKOFF_MS, 5_000, { max: 600_000 }),
  maxRecipientsPerJob: integer(process.env.WA_MAX_RECIPIENTS, 1_000, { min: 1, max: 10_000 }),
  maxQueuedJobs: integer(process.env.WA_MAX_QUEUED_JOBS, 10, { min: 1, max: 100 }),
  batchSize: integer(process.env.WA_BATCH_SIZE, 25, { min: 1, max: 1_000 }),
  batchPauseMs: integer(process.env.WA_BATCH_PAUSE_MS, 60_000, { max: 3_600_000 }),
  defaultCountryCode: (process.env.WA_DEFAULT_COUNTRY_CODE || '20').replace(/\D/g, '').slice(0, 3) || '20',
  verifyNumbers: bool(process.env.WA_VERIFY_NUMBERS, true),

  // HTTP JSON body cap. Must hold a full bulk payload: worst case ≈
  // maxRecipientsPerJob(messages) × 4 KB localized text × ~2 (UTF-8 + JSON
  // overhead). 10 MB comfortably covers the default 1 000-recipient limit
  // with maximum-length messages; raise together with WA_MAX_RECIPIENTS.
  jsonBodyLimit: (process.env.WA_JSON_BODY_LIMIT || '10mb').trim(),
}

export const isCloudApiConfigured = () => Boolean(config.cloudApi.token && config.cloudApi.phoneNumberId)
export const isWebhookConfigured = () => Boolean(config.webhook.url)
export const isSupabaseAuthConfigured = () => Boolean(config.supabase.url && config.supabase.anonKey)

export function validateConfig() {
  const authConfigured = Boolean(config.apiKey || isSupabaseAuthConfigured())
  if (!authConfigured && !config.allowInsecureLocal) {
    throw new Error(
      'Gateway authentication is not configured. Set SUPABASE_URL + SUPABASE_ANON_KEY, ' +
      'or WA_API_KEY for server-to-server access. WA_ALLOW_INSECURE_LOCAL=true is development-only.'
    )
  }
  if (config.isProduction && config.allowInsecureLocal) {
    throw new Error('WA_ALLOW_INSECURE_LOCAL cannot be enabled in production')
  }
  if (config.apiKey && config.apiKey.length < 32) {
    throw new Error('WA_API_KEY must contain at least 32 characters')
  }
  if (config.supabase.url && config.isProduction && !config.supabase.url.startsWith('https://')) {
    throw new Error('SUPABASE_URL must use HTTPS in production')
  }
  if (config.isProduction && config.allowedOrigins.includes('*')) {
    throw new Error('WA_ALLOWED_ORIGINS cannot contain * in production')
  }
  if (config.isProduction && config.provider === 'mock') {
    throw new Error('WA_PROVIDER=mock cannot be used in production')
  }
  if (!['whatsapp-web', 'cloud-api', 'webhook', 'mock'].includes(config.provider)) {
    throw new Error(`Unsupported WA_PROVIDER: ${config.provider}`)
  }
  if (!/^v\d+\.\d+$/.test(config.cloudApi.apiVersion)) {
    throw new Error('WA_CLOUD_API_VERSION must look like v20.0')
  }
  if (config.webhook.url) {
    let parsed
    try { parsed = new URL(config.webhook.url) } catch (_) { throw new Error('WA_WEBHOOK_URL is invalid') }
    if (config.isProduction && parsed.protocol !== 'https:') throw new Error('WA_WEBHOOK_URL must use HTTPS in production')
    if (!['POST', 'PUT'].includes(config.webhook.method)) throw new Error('WA_WEBHOOK_METHOD must be POST or PUT')
  }
}
