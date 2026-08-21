/**
 * Phone normalization / validation.
 * Deliberately identical to `src/lib/whatsapp.js` on the front-end so a
 * number that passes in the UI also passes on the gateway.
 */

export function normalizePhone(raw, defaultCountryCode = '20') {
  if (!raw) return ''
  let digits = String(raw).replace(/\D/g, '')
  if (!digits) return ''

  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith(defaultCountryCode)) return digits

  // Egyptian local mobile numbers: 010/011/012/015 + 8 digits
  if (digits.startsWith('01') && digits.length === 11) {
    return `${defaultCountryCode}${digits.slice(1)}`
  }
  if (/^(10|11|12|15)\d{8}$/.test(digits)) {
    return `${defaultCountryCode}${digits}`
  }
  if (digits.startsWith('0')) return `${defaultCountryCode}${digits.slice(1)}`
  if (digits.length >= 11) return digits
  return `${defaultCountryCode}${digits}`
}

export function validatePhone(raw, defaultCountryCode = '20') {
  if (!raw || !String(raw).trim()) {
    return { isValid: false, normalized: '', error: 'Phone number is required' }
  }

  const normalized = normalizePhone(raw, defaultCountryCode)

  if (normalized.length < 10 || normalized.length > 15) {
    return { isValid: false, normalized, error: `Invalid phone length (${normalized.length} digits)` }
  }

  if (normalized.startsWith('20')) {
    const local = normalized.slice(2)
    if (!/^(10|11|12|15)\d{8}$/.test(local)) {
      return {
        isValid: false,
        normalized,
        error: 'Invalid Egyptian mobile number (must start with 010/011/012/015 and be 11 digits)',
      }
    }
  }

  return { isValid: true, normalized, error: null }
}

/** WhatsApp chat id used by whatsapp-web.js / Baileys. */
export const toChatId = (normalized) => `${normalized}@c.us`
