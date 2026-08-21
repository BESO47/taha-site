/**
 * Meta WhatsApp Cloud API provider.
 * Official, no browser required, but the number must be registered as a
 * WhatsApp Business number and free-form text only works inside the 24h
 * customer-service window (otherwise a pre-approved template is used).
 */
import { config, isCloudApiConfigured } from '../config.js'
import { validatePhone } from '../phone.js'

export async function start() {
  if (!isCloudApiConfigured()) {
    throw new Error('Set WA_CLOUD_TOKEN and WA_CLOUD_PHONE_NUMBER_ID to use the Cloud API provider')
  }
  return getStatus()
}

export async function stop() {
  return getStatus()
}

export function getStatus() {
  const ok = isCloudApiConfigured()
  return {
    provider: 'cloud-api',
    status: ok ? 'ready' : 'stopped',
    ready: ok,
    qr: null,
    needsScan: false,
    me: ok ? { id: config.cloudApi.phoneNumberId } : null,
    lastError: ok ? null : 'WA_CLOUD_TOKEN / WA_CLOUD_PHONE_NUMBER_ID missing',
  }
}

export async function checkNumber(phone) {
  const { isValid, normalized } = validatePhone(phone, config.defaultCountryCode)
  return isValid ? normalized : null
}

export async function sendMessage(phone, message) {
  if (!isCloudApiConfigured()) throw new Error('Cloud API credentials are missing')

  const { isValid, normalized, error } = validatePhone(phone, config.defaultCountryCode)
  if (!isValid) throw new Error(error)

  const url = `https://graph.facebook.com/${config.cloudApi.apiVersion}/${config.cloudApi.phoneNumberId}/messages`

  const body = config.cloudApi.templateName
    ? {
        messaging_product: 'whatsapp',
        to: normalized,
        type: 'template',
        template: {
          name: config.cloudApi.templateName,
          language: { code: config.cloudApi.templateLang },
          components: [{ type: 'body', parameters: [{ type: 'text', text: message }] }],
        },
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalized,
        type: 'text',
        text: { preview_url: false, body: message },
      }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.webhook.timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.cloudApi.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.error?.message || `Cloud API responded with ${res.status}`)
    }
    return { id: data?.messages?.[0]?.id || null, chatId: normalized }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Cloud API request timed out')
    throw err
  } finally {
    clearTimeout(timer)
  }
}
