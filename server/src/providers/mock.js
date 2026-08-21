/**
 * Mock provider — validates numbers and pretends to send.
 * Use it to rehearse a campaign (`npm run mock`) without touching WhatsApp.
 */
import { config } from '../config.js'
import { log } from '../logger.js'
import { validatePhone } from '../phone.js'

export async function start() { return getStatus() }
export async function stop() { return getStatus() }

export function getStatus() {
  return {
    provider: 'mock',
    status: 'ready',
    ready: true,
    qr: null,
    needsScan: false,
    me: { id: 'mock@c.us', pushname: 'Mock session' },
    lastError: null,
  }
}

export async function checkNumber(phone) {
  const { isValid, normalized } = validatePhone(phone, config.defaultCountryCode)
  return isValid ? normalized : null
}

export async function sendMessage(phone, message) {
  const { isValid, normalized, error } = validatePhone(phone, config.defaultCountryCode)
  if (!isValid) throw new Error(error)
  log.info(`[mock] -> +${normalized}: ${String(message).slice(0, 60).replace(/\n/g, ' ')}…`)
  await new Promise((r) => setTimeout(r, 150))
  return { id: `mock_${Date.now()}`, chatId: `${normalized}@c.us` }
}
