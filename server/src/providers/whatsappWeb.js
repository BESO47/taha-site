/**
 * whatsapp-web.js provider — a real WhatsApp Web session driven by
 * Puppeteer. Free, no Meta business account, supports any personal or
 * business number. Requires a persistent Node process + Chromium.
 *
 * State machine:
 *   stopped -> starting -> qr -> authenticated -> ready
 *                       \-> auth_failure / disconnected -> stopped
 *
 * The session is stored on disk (LocalAuth), so the QR only has to be
 * scanned once per server — restarts reconnect automatically.
 */
import { createRequire } from 'node:module'
import QRCode from 'qrcode'
import { config } from '../config.js'
import { log } from '../logger.js'
import { normalizePhone, toChatId, validatePhone } from '../phone.js'

const require = createRequire(import.meta.url)

const state = {
  status: 'stopped',      // stopped | starting | qr | authenticated | ready | auth_failure | disconnected
  qr: null,               // raw QR string
  qrDataUrl: null,        // data:image/png;base64,... (rendered for the admin UI)
  qrGeneratedAt: null,
  me: null,               // { id, pushname, platform }
  lastError: null,
  startedAt: null,
  restartCount: 0,
}

let client = null
let starting = null

function setStatus(next, extra = {}) {
  state.status = next
  Object.assign(state, extra)
  log.info(`WhatsApp session -> ${next}`)
}

/** Load whatsapp-web.js lazily so the API boots even if it is not installed. */
function loadLibrary() {
  try {
    return require('whatsapp-web.js')
  } catch (err) {
    throw new Error(
      'whatsapp-web.js is not installed. Run `npm install` inside the `server/` folder ' +
      '(it downloads a bundled Chromium, ~150 MB).'
    )
  }
}

export async function start() {
  if (state.status === 'ready' || state.status === 'authenticated') return getStatus()
  if (starting) return starting

  starting = (async () => {
    const { Client, LocalAuth } = loadLibrary()

    setStatus('starting', { lastError: null, qr: null, qrDataUrl: null })

    client = new Client({
      authStrategy: new LocalAuth({ clientId: config.sessionId, dataPath: config.sessionDir }),
      puppeteer: {
        headless: config.headless,
        executablePath: config.chromiumPath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      },
    })

    client.on('qr', async (qr) => {
      state.qr = qr
      state.qrGeneratedAt = new Date().toISOString()
      try {
        state.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
      } catch (err) {
        log.warn('Could not render the QR as an image:', err.message)
      }
      setStatus('qr')
      if (config.printQrInTerminal) {
        try {
          const qrTerminal = require('qrcode-terminal')
          qrTerminal.generate(qr, { small: true })
          log.info('Scan the QR above with WhatsApp -> Linked devices -> Link a device')
        } catch (_) {
          log.info('QR received. Open the admin dashboard to scan it.')
        }
      }
    })

    client.on('authenticated', () => setStatus('authenticated', { qr: null, qrDataUrl: null }))

    client.on('auth_failure', (msg) => {
      setStatus('auth_failure', { lastError: String(msg) })
    })

    client.on('ready', () => {
      state.restartCount = 0
      setStatus('ready', {
        qr: null,
        qrDataUrl: null,
        startedAt: new Date().toISOString(),
        me: client.info
          ? { id: client.info.wid?._serialized, pushname: client.info.pushname, platform: client.info.platform }
          : null,
      })
    })

    client.on('disconnected', async (reason) => {
      setStatus('disconnected', { lastError: String(reason), me: null })
      try { await client.destroy() } catch (_) {}
      client = null
      // Auto-reconnect once: WhatsApp regularly drops idle web sessions.
      if (state.restartCount < 3) {
        state.restartCount += 1
        log.warn(`Reconnecting (attempt ${state.restartCount})…`)
        setTimeout(() => { start().catch((e) => log.error('Reconnect failed:', e.message)) }, 5000)
      }
    })

    try {
      await client.initialize()
    } catch (err) {
      setStatus('stopped', { lastError: err.message })
      client = null
      throw err
    } finally {
      starting = null
    }

    return getStatus()
  })()

  return starting
}

export async function stop({ logout = false } = {}) {
  if (!client) {
    setStatus('stopped', { qr: null, qrDataUrl: null, me: null })
    return getStatus()
  }
  try {
    if (logout) await client.logout()
  } catch (err) {
    log.warn('Logout error:', err.message)
  }
  try {
    await client.destroy()
  } catch (err) {
    log.warn('Destroy error:', err.message)
  }
  client = null
  setStatus('stopped', { qr: null, qrDataUrl: null, me: null })
  return getStatus()
}

export function getStatus() {
  return {
    provider: 'whatsapp-web',
    status: state.status,
    ready: state.status === 'ready',
    qr: state.qrDataUrl,
    qrGeneratedAt: state.qrGeneratedAt,
    me: state.me,
    lastError: state.lastError,
    startedAt: state.startedAt,
    needsScan: state.status === 'qr',
  }
}

/** Is this number actually registered on WhatsApp? */
export async function checkNumber(phone) {
  if (!client || state.status !== 'ready') throw new Error('WhatsApp session is not ready')
  const normalized = normalizePhone(phone, config.defaultCountryCode)
  const numberId = await client.getNumberId(normalized)
  return numberId ? numberId._serialized : null
}

/**
 * Send one text message.
 * @returns {{ id:string, chatId:string }}
 */
export async function sendMessage(phone, message) {
  if (!client || state.status !== 'ready') {
    throw new Error(
      `WhatsApp session is not ready (current state: ${state.status}). ` +
      'Open the admin dashboard and scan the QR code.'
    )
  }

  const { isValid, normalized, error } = validatePhone(phone, config.defaultCountryCode)
  if (!isValid) throw new Error(error)

  let chatId = toChatId(normalized)
  if (config.verifyNumbers) {
    const resolved = await client.getNumberId(normalized)
    if (!resolved) throw new Error(`+${normalized} is not registered on WhatsApp`)
    chatId = resolved._serialized
  }

  const sent = await client.sendMessage(chatId, message)
  return { id: sent?.id?._serialized || null, chatId }
}
