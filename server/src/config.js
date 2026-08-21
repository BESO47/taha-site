/**
 * Gateway configuration — every knob is an environment variable so the
 * same build runs locally, on a VPS or inside Docker.
 */
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) ? n : fallback
}

export const config = {
  // ---- HTTP ----
  port: int(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',
  apiKey: (process.env.WA_API_KEY || '').trim(),
  allowedOrigins: (process.env.WA_ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ---- Provider: whatsapp-web | cloud-api | webhook | mock ----
  provider: (process.env.WA_PROVIDER || 'whatsapp-web').trim(),

  // whatsapp-web.js
  sessionDir: process.env.WA_SESSION_DIR || path.resolve(__dirname, '../.wwebjs_auth'),
  sessionId: process.env.WA_SESSION_ID || 'physics-hub',
  chromiumPath: process.env.WA_CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  headless: (process.env.WA_HEADLESS || 'true') !== 'false',
  autoStart: (process.env.WA_AUTO_START || 'true') !== 'false',
  printQrInTerminal: (process.env.WA_PRINT_QR || 'true') !== 'false',

  // Meta WhatsApp Cloud API
  cloudApi: {
    token: process.env.WA_CLOUD_TOKEN || '',
    phoneNumberId: process.env.WA_CLOUD_PHONE_NUMBER_ID || '',
    apiVersion: process.env.WA_CLOUD_API_VERSION || 'v20.0',
    // Cloud API can only send free-form text inside the 24h window; outside
    // of it a template is required.
    templateName: process.env.WA_CLOUD_TEMPLATE || '',
    templateLang: process.env.WA_CLOUD_TEMPLATE_LANG || 'ar',
  },

  // Generic HTTP relay (UltraMsg, Green API, Baileys micro-service, n8n...)
  webhook: {
    url: process.env.WA_WEBHOOK_URL || '',
    method: (process.env.WA_WEBHOOK_METHOD || 'POST').toUpperCase(),
    authHeader: process.env.WA_WEBHOOK_AUTH_HEADER || '',
    authValue: process.env.WA_WEBHOOK_AUTH_VALUE || '',
    timeoutMs: int(process.env.WA_WEBHOOK_TIMEOUT_MS, 20000),
  },

  // ---- Dispatch safety ----
  defaultDelayMs: int(process.env.WA_DEFAULT_DELAY_MS, 4000),
  defaultJitterMs: int(process.env.WA_DEFAULT_JITTER_MS, 2000),
  maxRetries: int(process.env.WA_MAX_RETRIES, 2),
  retryBackoffMs: int(process.env.WA_RETRY_BACKOFF_MS, 5000),
  maxRecipientsPerJob: int(process.env.WA_MAX_RECIPIENTS, 1000),
  // Long pause after every N messages — the single most effective way to
  // avoid WhatsApp rate limiting on large blasts.
  batchSize: int(process.env.WA_BATCH_SIZE, 25),
  batchPauseMs: int(process.env.WA_BATCH_PAUSE_MS, 60000),
  defaultCountryCode: process.env.WA_DEFAULT_COUNTRY_CODE || '20',
  verifyNumbers: (process.env.WA_VERIFY_NUMBERS || 'true') !== 'false',
}

export const isCloudApiConfigured = () =>
  Boolean(config.cloudApi.token && config.cloudApi.phoneNumberId)

export const isWebhookConfigured = () => Boolean(config.webhook.url)
