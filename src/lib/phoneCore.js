/**
 * Pure phone & WhatsApp-URL helpers shared by every messaging surface.
 *
 * This module is intentionally dependency-free (no supabase, no
 * import.meta.env, no window access outside guarded functions) so it can
 * run in the browser, in the Vite bundle, and in plain Node for the
 * messaging unit tests (scripts/test-messaging.mjs).
 *
 * `whatsapp.js` re-exports everything from here, so existing imports keep
 * working unchanged.
 */

/**
 * Normalizes any phone input into standard international digits-only format.
 * Defaults to Egypt (+20) if leading 0 or 1 is provided.
 *
 * Examples:
 *   '01012345678'    -> '201012345678'
 *   '+201012345678'  -> '201012345678'
 *   '00201012345678' -> '201012345678'
 *   '011 2345-6789'  -> '201123456789'
 *   '+966 50 1234567'-> '966501234567'
 */
export function normalizePhone(raw, defaultCountryCode = '20') {
  if (!raw) return ''
  let digits = String(raw).replace(/\D/g, '')

  if (!digits) return ''

  // Strip international double-zero prefix (0020... -> 20...)
  if (digits.startsWith('00')) {
    digits = digits.slice(2)
  }

  // Already prefixed with country code
  if (digits.startsWith(defaultCountryCode)) {
    return digits
  }

  // Egyptian local mobile numbers (010, 011, 012, 015) -> prepend 20
  if (digits.startsWith('01') && digits.length === 11) {
    return `${defaultCountryCode}${digits.slice(1)}`
  }

  // Missing leading 0 for 10-digit Egyptian mobile (10..., 11..., 12..., 15...)
  if ((digits.startsWith('10') || digits.startsWith('11') || digits.startsWith('12') || digits.startsWith('15')) && digits.length === 10) {
    return `${defaultCountryCode}${digits}`
  }

  // Standard leading 0 removal and prepending country code
  if (digits.startsWith('0')) {
    return `${defaultCountryCode}${digits.slice(1)}`
  }

  // If >= 11 digits and not starting with country code, treat as international
  if (digits.length >= 11) {
    return digits
  }

  return `${defaultCountryCode}${digits}`
}

/**
 * Formats a phone number with leading `+` for display or specific API integrations.
 */
export function formatPhoneWithPlus(phone) {
  const norm = normalizePhone(phone)
  return norm ? `+${norm}` : ''
}

/**
 * Validates whether a phone number is structurally valid.
 * @returns {{isValid:boolean, normalized:string, formatted:string, error:string|null}}
 */
export function validatePhone(raw, defaultCountryCode = '20') {
  if (!raw || !String(raw).trim()) {
    return {
      isValid: false,
      normalized: '',
      formatted: '',
      error: 'رقم الهاتف مطلوب / Phone number is required',
    }
  }

  const normalized = normalizePhone(raw, defaultCountryCode)

  if (normalized.length < 10 || normalized.length > 15) {
    return {
      isValid: false,
      normalized,
      formatted: `+${normalized}`,
      error: `طول رقم الهاتف غير صالح (${normalized.length} أرقام) / Invalid phone length`,
    }
  }

  // Check Egyptian format specific rules
  if (normalized.startsWith('20')) {
    const localPart = normalized.slice(2)
    const validPrefix = /^(10|11|12|15)\d{8}$/.test(localPart)
    if (!validPrefix) {
      return {
        isValid: false,
        normalized,
        formatted: `+${normalized}`,
        error: 'رقم محمول مصري غير صالح (يجب أن يبدأ بـ 010 أو 011 أو 012 أو 015 ومكون من 11 رقماً)',
      }
    }
  }

  return {
    isValid: true,
    normalized,
    formatted: `+${normalized}`,
    error: null,
  }
}

/** Detect coarse device class for WhatsApp deep-link routing. Browser-safe. */
export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const touch = typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)
    || (touch && /Macintosh/i.test(ua))
}

/**
 * Device-aware WhatsApp send URL.
 * Mobile: api.whatsapp.com (hands off to the native app)
 * Desktop: web.whatsapp.com
 * Phone is digits-only international (no +).
 */
export function buildChatUrl(phone, message, { mobile } = {}) {
  const to = normalizePhone(phone)
  if (!to) return null
  const text = encodeURIComponent(message ?? '')
  const useMobile = mobile ?? isMobileDevice()
  if (useMobile) {
    return `https://api.whatsapp.com/send?phone=${to}&text=${text}`
  }
  return `https://web.whatsapp.com/send?phone=${to}&text=${text}`
}

/** Native-scheme fallback when the https deep link is blocked. */
export function buildNativeWhatsAppUrl(phone, message) {
  const to = normalizePhone(phone)
  if (!to) return null
  return `whatsapp://send?phone=${to}&text=${encodeURIComponent(message ?? '')}`
}
