import { createHash, timingSafeEqual } from 'node:crypto'
import { config, isSupabaseAuthConfigured } from './config.js'

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
  }
}

const cache = new Map()
const MAX_CACHE_ENTRIES = 200

const tokenKey = (token) => createHash('sha256').update(token).digest('hex')
const safeEqual = (left, right) => {
  const leftHash = createHash('sha256').update(String(left)).digest()
  const rightHash = createHash('sha256').update(String(right)).digest()
  return timingSafeEqual(leftHash, rightHash)
}

const isLoopback = (ip = '') => {
  const normalized = String(ip).replace(/^::ffff:/, '')
  return normalized === '127.0.0.1' || normalized === '::1'
}

async function fetchJson(url, options) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) throw new HttpError(401, 'Invalid or expired session')
    return await response.json()
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error.name === 'AbortError') throw new HttpError(503, 'Authentication service timed out')
    throw new HttpError(503, 'Authentication service unavailable')
  } finally {
    clearTimeout(timer)
  }
}

async function verifySupabaseAdmin(token) {
  if (!isSupabaseAuthConfigured()) throw new HttpError(401, 'Bearer authentication is not configured')
  if (!token || token.length > 8_192) throw new HttpError(401, 'Invalid or missing session')

  const key = tokenKey(token)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.principal
  cache.delete(key)

  const headers = {
    apikey: config.supabase.anonKey,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
  const user = await fetchJson(`${config.supabase.url}/auth/v1/user`, { headers })
  if (!user?.id) throw new HttpError(401, 'Invalid or expired session')

  const profiles = await fetchJson(
    `${config.supabase.url}/rest/v1/profiles?select=id,role,is_active&id=eq.${encodeURIComponent(user.id)}&limit=1`,
    { headers }
  )
  const profile = Array.isArray(profiles) ? profiles[0] : null
  if (!profile || profile.role !== 'admin' || profile.is_active === false) {
    throw new HttpError(403, 'Administrator access required')
  }

  const principal = { id: user.id, type: 'supabase-admin' }
  cache.set(key, { principal, expiresAt: Date.now() + config.supabase.authCacheMs })
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
  return principal
}

export async function authenticateAdmin(req) {
  const providedApiKey = req.get('x-api-key') || ''
  if (config.apiKey && providedApiKey && safeEqual(providedApiKey, config.apiKey)) {
    return { id: 'service', type: 'api-key' }
  }

  const authorization = req.get('authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (match) return verifySupabaseAdmin(match[1].trim())

  if (config.allowInsecureLocal && !config.isProduction && isLoopback(req.ip || req.socket?.remoteAddress)) {
    return { id: 'local-development', type: 'insecure-local' }
  }

  throw new HttpError(401, 'Authentication required')
}

export function clearAuthCache() {
  cache.clear()
}
