import { HttpError } from './auth.js'

export const MAX_MESSAGE_LENGTH = 4_096

const plainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const cleanText = (value, maxLength) => String(value || '').trim().slice(0, maxLength)

export function sanitizeMeta(value) {
  if (!plainObject(value)) return {}
  return {
    studentId: cleanText(value.studentId, 100) || null,
    studentName: cleanText(value.studentName, 120),
    groupName: cleanText(value.groupName, 80),
    recipientType: value.recipientType === 'parent' || value.target === 'parent' ? 'parent' : 'student',
  }
}

export function validateMessage(value) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'message is required')
  if (value.length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(413, `message exceeds ${MAX_MESSAGE_LENGTH} characters`)
  }
  return value.trim()
}

export function validateSinglePayload(body) {
  if (!plainObject(body)) throw new HttpError(400, 'A JSON object is required')
  if (!body.phone) throw new HttpError(400, 'phone is required')
  return {
    phone: cleanText(body.phone, 40),
    message: validateMessage(body.message),
    meta: sanitizeMeta(body.meta),
  }
}

const boundedNumber = (value, fallback, min, max, label) => {
  if (value == null || value === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, `${label} must be between ${min} and ${max}`)
  }
  return number
}

export function validateBulkPayload(body, config) {
  if (!plainObject(body) || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw new HttpError(400, 'messages must be a non-empty array')
  }
  if (body.messages.length > config.maxRecipientsPerJob) {
    throw new HttpError(413, `Too many recipients. Limit is ${config.maxRecipientsPerJob}.`)
  }

  const messages = body.messages.map((item, index) => {
    try {
      return validateSinglePayload(item)
    } catch (error) {
      throw new HttpError(error.statusCode || 400, `messages[${index}]: ${error.message}`)
    }
  })

  return {
    messages,
    options: {
      delayMs: boundedNumber(body.delayMs, config.defaultDelayMs, 0, 600_000, 'delayMs'),
      jitterMs: boundedNumber(body.jitterMs, config.defaultJitterMs, 0, 600_000, 'jitterMs'),
      batchSize: boundedNumber(body.batchSize, config.batchSize, 1, 1_000, 'batchSize'),
      batchPauseMs: boundedNumber(body.batchPauseMs, config.batchPauseMs, 0, 3_600_000, 'batchPauseMs'),
      maxRetries: boundedNumber(body.maxRetries, config.maxRetries, 0, 10, 'maxRetries'),
      dryRun: body.dryRun === true,
    },
  }
}
