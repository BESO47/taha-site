/**
 * Generic HTTP relay provider — point WA_WEBHOOK_URL at UltraMsg, Green API,
 * a Baileys micro-service, n8n, Make, Zapier… The payload carries every
 * common field name so most relays work without any mapping.
 */
import { config, isWebhookConfigured } from '../config.js'
import { toChatId, validatePhone } from '../phone.js'

export async function start() {
  if (!isWebhookConfigured()) throw new Error('WA_WEBHOOK_URL is not configured')
  return getStatus()
}

export async function stop() {
  return getStatus()
}

export function getStatus() {
  const ok = isWebhookConfigured()
  return {
    provider: 'webhook',
    status: ok ? 'ready' : 'stopped',
    ready: ok,
    qr: null,
    needsScan: false,
    me: ok ? { id: 'configured-webhook' } : null,
    lastError: ok ? null : 'WA_WEBHOOK_URL missing',
  }
}

export async function checkNumber(phone) {
  const { isValid, normalized } = validatePhone(phone, config.defaultCountryCode)
  return isValid ? normalized : null
}

export async function sendMessage(phone, message, meta = {}) {
  if (!isWebhookConfigured()) throw new Error('WA_WEBHOOK_URL is not configured')

  const { isValid, normalized, error } = validatePhone(phone, config.defaultCountryCode)
  if (!isValid) throw new Error(error)

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (config.webhook.authHeader && config.webhook.authValue) {
    headers[config.webhook.authHeader] = config.webhook.authValue
  }

  const safeMeta = {
    studentId: String(meta.studentId || '').slice(0, 100) || null,
    studentName: String(meta.studentName || '').slice(0, 120),
    groupName: String(meta.groupName || '').slice(0, 80),
    recipientType: meta.recipientType === 'parent' ? 'parent' : 'student',
  }
  // Authoritative delivery fields come last so metadata can never override
  // the recipient or message sent to the relay.
  const payload = {
    ...safeMeta,
    to: normalized,
    phone: normalized,
    formattedPhone: `+${normalized}`,
    chatId: toChatId(normalized),
    message,
    body: message,
    text: message,
    timestamp: new Date().toISOString(),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.webhook.timeoutMs)

  try {
    const res = await fetch(config.webhook.url, {
      method: config.webhook.method,
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.message || data?.error || `Relay responded with ${res.status}`)
    }
    return { id: data?.id || data?.messageId || null, chatId: normalized }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Relay request timed out')
    throw err
  } finally {
    clearTimeout(timer)
  }
}
