/**
 * WhatsApp integration & bulk messaging engine for Physics Hub.
 *
 * Features:
 *   - Universal phone normalization & strict validation (Egypt +20 / International).
 *   - Safe rate limiting / async dispatch queue (2-5s per message) to prevent bans.
 *   - Multi-format webhook payload support (UltraMsg, Green API, Baileys, custom HTTP relays).
 *   - Comprehensive database logging to `whatsapp_logs` table with delivery status.
 *   - Rich report generation for student progress.
 */

import { supabase, isSupabaseConfigured } from './supabase'

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

  // If >= 10 digits and not starting with country code, return as is (international) or prepend default
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

function pct(n) {
  const v = Number(n)
  return Number.isFinite(v) ? `${Math.round(v)}%` : '—'
}

/**
 * Build the summary message sent to a student or parent.
 */
export function buildReportMessage({
  studentName,
  groupName = '',
  analytics = {},
  recentGrades = [],
  recentAttendance = [],
  pendingAssignments = [],
  lang = 'ar',
  teacherName = 'م. طه الصباغ',
  platformName = 'Physics Hub',
}) {
  const ar = lang === 'ar'
  const L = []

  if (ar) {
    L.push(`*تقرير متابعة الطالب - ${platformName}*`)
    L.push(`الطالب: *${studentName}*`)
    if (groupName) {
      L.push(`المجموعة: *${groupName}*`)
    }
    L.push('')
    L.push('*📊 ملخص الأداء الأكاديمي:*')
    L.push(`• نسبة الحضور: ${pct(analytics.attendance_percent)} (${analytics.present_count || 0} من ${analytics.total_sessions || 0} حصة)`)
    L.push(`• عدد مرات الغياب: ${analytics.absent_count || 0}`)
    L.push(`• متوسط درجات الاختبارات: ${pct(analytics.avg_quiz_percent)} (${analytics.quiz_count || 0} اختبار)`)
    L.push(`• متوسط درجات الواجبات: ${pct(analytics.avg_assignment_percent)} (${analytics.submission_count || 0} واجب مُسلَّم)`)

    if (recentGrades.length) {
      L.push('')
      L.push('*📝 آخر الاختبارات:*')
      recentGrades.slice(0, 5).forEach((g) => {
        const title = g.quizzes?.title || 'اختبار'
        const max = g.quizzes?.max_score || 100
        L.push(`• ${title}: ${g.score} / ${max}`)
      })
    }

    if (recentAttendance.length) {
      const map = { present: 'حاضر ✅', absent: 'غائب ❌', late: 'متأخر ⏳', excused: 'بعذر 📄' }
      L.push('')
      L.push('*📅 آخر سجلات الحضور:*')
      recentAttendance.slice(0, 5).forEach((a) => {
        L.push(`• ${a.session_date}: ${map[a.status] || a.status}`)
      })
    }

    if (pendingAssignments.length) {
      L.push('')
      L.push('*⚠️ واجبات في انتظار التسليم:*')
      pendingAssignments.slice(0, 5).forEach((a) => L.push(`• ${a.title}`))
    }

    L.push('')
    L.push(`مع أطيب تمنياتنا بالتفوق والنجاح،`)
    L.push(`${teacherName} | physics بطريقه مختلفه ⚡`)
  } else {
    L.push(`*Student Progress Report - ${platformName}*`)
    L.push(`Student: *${studentName}*`)
    if (groupName) {
      L.push(`Group: *${groupName}*`)
    }
    L.push('')
    L.push('*📊 Performance Summary:*')
    L.push(`• Attendance: ${pct(analytics.attendance_percent)} (${analytics.present_count || 0} of ${analytics.total_sessions || 0} sessions)`)
    L.push(`• Absences: ${analytics.absent_count || 0}`)
    L.push(`• Quiz average: ${pct(analytics.avg_quiz_percent)} (${analytics.quiz_count || 0} quizzes)`)
    L.push(`• Homework average: ${pct(analytics.avg_assignment_percent)} (${analytics.submission_count || 0} submitted)`)

    if (recentGrades.length) {
      L.push('')
      L.push('*📝 Recent Quizzes:*')
      recentGrades.slice(0, 5).forEach((g) => {
        const title = g.quizzes?.title || 'Quiz'
        const max = g.quizzes?.max_score || 100
        L.push(`• ${title}: ${g.score} / ${max}`)
      })
    }

    if (recentAttendance.length) {
      L.push('')
      L.push('*📅 Recent Attendance:*')
      recentAttendance.slice(0, 5).forEach((a) => L.push(`• ${a.session_date}: ${a.status}`))
    }

    if (pendingAssignments.length) {
      L.push('')
      L.push('*⚠️ Outstanding Assignments:*')
      pendingAssignments.slice(0, 5).forEach((a) => L.push(`• ${a.title}`))
    }

    L.push('')
    L.push(`Best regards,`)
    L.push(`${teacherName} | Physics Hub`)
  }

  return L.join('\n')
}

/** Open WhatsApp with the message pre-filled. */
export function openWhatsApp(phone, message) {
  const to = normalizePhone(phone)
  if (!to) throw new Error('Missing or invalid phone number')
  const url = `https://wa.me/${to}?text=${encodeURIComponent(message)}`
  window.open(url, '_blank', 'noopener,noreferrer')
  return url
}

/**
 * Build a web.whatsapp.com chat URL (desktop WhatsApp Web).
 * https://web.whatsapp.com/send?phone=<international>&text=<urlencoded>
 * Used by the sequential bulk-send queue so every recipient chat opens on
 * WhatsApp Web directly.
 */
export function buildChatUrl(phone, message) {
  const to = normalizePhone(phone)
  if (!to) return null
  return `https://web.whatsapp.com/send?phone=${to}&text=${encodeURIComponent(message)}`
}

/**
 * Create a queue controller that lets a long-running dispatch loop be
 * paused, resumed and cancelled safely from the UI.
 *
 * @returns {{ paused: boolean, cancelled: boolean, pause(): void, resume(): void, cancel(): void }}
 */
export function createQueueController() {
  return {
    paused: false,
    cancelled: false,
    _waiters: [],
    pause() {
      this.paused = true
    },
    resume() {
      this.paused = false
      this._waiters.splice(0).forEach((w) => w())
    },
    cancel() {
      this.cancelled = true
      this.resume()
    },
  }
}

/** Block the loop while the controller is paused (resolves on resume/cancel). */
async function holdWhilePaused(controller) {
  while (controller?.paused && !controller?.cancelled) {
    await new Promise((resolve) => controller._waiters.push(resolve))
  }
}

/**
 * Interruptible sleep that respects pause/cancel. Returns false when the
 * queue should stop (cancelled), true when the full delay elapsed.
 */
async function delayWithController(ms, controller) {
  const step = 200
  const end = Date.now() + ms
  while (Date.now() < end) {
    await holdWhilePaused(controller)
    if (controller?.cancelled) return false
    await sleep(Math.min(step, end - Date.now()))
  }
  return true
}

const WEBHOOK_URL = import.meta.env.VITE_WHATSAPP_WEBHOOK_URL

export function isWebhookConfigured() {
  return Boolean(WEBHOOK_URL && String(WEBHOOK_URL).trim().length > 5)
}

/** Helper sleep function for rate limiting / delay */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Log WhatsApp outgoing message status to database table `whatsapp_logs`.
 */
export async function logWhatsAppDispatch({
  studentId = null,
  phone,
  recipientName = '',
  recipientType = 'student',
  messageBody = '',
  status = 'sent',
  errorMessage = null,
}) {
  const normalizedPhone = normalizePhone(phone)

  // Local storage backup for offline/mock mode
  try {
    const key = 'physics_hub_whatsapp_logs'
    const existing = JSON.parse(localStorage.getItem(key) || '[]')
    const newEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      student_id: studentId,
      phone: normalizedPhone,
      recipient_name: recipientName,
      recipient_type: recipientType,
      message_body: messageBody,
      status,
      error_message: errorMessage,
      sent_at: new Date().toISOString(),
    }
    localStorage.setItem(key, JSON.stringify([newEntry, ...existing].slice(0, 200)))
  } catch (err) {
    // ignore local storage errors
  }

  // Persist to Supabase if configured
  if (isSupabaseConfigured()) {
    try {
      await supabase.from('whatsapp_logs').insert([
        {
          student_id: studentId || null,
          phone: normalizedPhone,
          recipient_name: recipientName || null,
          recipient_type: recipientType || 'student',
          message_body: messageBody,
          status,
          error_message: errorMessage || null,
          sent_at: new Date().toISOString(),
        },
      ])
    } catch (err) {
      console.warn('Failed to insert into whatsapp_logs table:', err)
    }
  }
}

/**
 * Fetch WhatsApp delivery logs from Supabase / localStorage.
 */
export async function fetchWhatsAppLogs({ limit = 50 } = {}) {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_logs')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(limit)

      if (!error && Array.isArray(data)) {
        return data
      }
    } catch (err) {
      console.warn('Failed to fetch whatsapp_logs from Supabase:', err)
    }
  }

  // Fallback to local storage
  try {
    const raw = localStorage.getItem('physics_hub_whatsapp_logs')
    if (raw) return JSON.parse(raw).slice(0, limit)
  } catch (err) {}

  return []
}

/**
 * POST message to external webhook / Cloud API / UltraMsg / Baileys / Green API.
 * Includes multi-provider payload mapping and 15s timeout.
 */
export async function sendViaWebhook(phone, message, meta = {}) {
  if (!isWebhookConfigured()) {
    throw new Error('VITE_WHATSAPP_WEBHOOK_URL is not configured in .env')
  }

  const validation = validatePhone(phone)
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid phone number')
  }

  const normalized = validation.normalized
  const formattedWithPlus = validation.formatted

  // Multi-provider compatible payload
  const payload = {
    to: normalized,
    phone: normalized,
    formattedPhone: formattedWithPlus,
    chatId: `${normalized}@c.us`,
    message,
    body: message,
    studentId: meta.studentId || null,
    studentName: meta.studentName || '',
    groupName: meta.groupName || '',
    target: meta.target || 'student',
    recipientType: meta.target || 'student',
    timestamp: new Date().toISOString(),
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      let errorText = `Webhook responded with status ${res.status}`
      try {
        const errorJson = await res.json()
        if (errorJson.message || errorJson.error || errorJson.reason) {
          errorText = errorJson.message || errorJson.error || errorJson.reason
        }
      } catch (_) {}
      throw new Error(errorText)
    }

    const data = await res.json().catch(() => ({ ok: true, status: 'sent' }))
    return { ok: true, data }
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      throw new Error('Webhook request timed out after 15 seconds')
    }
    throw err
  }
}

/**
 * Sequential Bulk WhatsApp Dispatch Engine with Rate Limiting & Delays (2-5s per message)
 * Logs every dispatch result to the database and returns structured summary.
 *
 * Recipients are processed ONE BY ONE (Index + 1) — the next message is only
 * dispatched after the current one completes AND the configured delay elapses,
 * so the chat context fully loads before proceeding. The queue can be paused,
 * resumed and cancelled at any point via a controller.
 *
 * @param {Array<{ phone: string, message: string, record?: object, studentName?: string, studentId?: string, target?: string }>} messages
 * @param {Object} options
 * @param {number} options.delayMs - delay between messages (default 3000ms)
 * @param {Function} options.onProgress - progress callback: ({ current, total, percent, studentName, phone, currentStatus, successfulCount, failedCount, delayRemaining }) => void
 * @param {AbortSignal} options.signal - optional abort signal to cancel in-flight webhook fetch
 * @param {Object} options.controller - queue controller from createQueueController() for pause/resume/cancel
 * @returns {Promise<{ total: number, sent: number, failed: number, successfulCount: number, failedCount: number, errors: Array, logs: Array }>}
 */
export async function dispatchBulkWhatsAppQueue(
  messages = [],
  {
    delayMs = 3000,
    onProgress = null,
    signal = null,
    controller = null,
  } = {}
) {
  const total = messages.length
  let successfulCount = 0
  let failedCount = 0
  const errors = []
  const logs = []

  for (let i = 0; i < total; i++) {
    if (signal?.aborted || controller?.cancelled) {
      console.log('Bulk dispatch aborted by user.')
      break
    }

    // Respect pause before starting the next recipient
    await holdWhilePaused(controller)
    if (signal?.aborted || controller?.cancelled) break

    const item = messages[i]
    const studentName = item.record?.full_name || item.studentName || 'Student'
    const studentId = item.record?.student_id || item.studentId || null
    const recipientType = item.target || 'student'
    const rawPhone = item.phone

    // Notify progress: start of item
    onProgress?.({
      current: i + 1,
      total,
      percent: Math.round(((i + 1) / total) * 100),
      studentName,
      phone: rawPhone,
      currentStatus: 'sending',
      successfulCount,
      failedCount,
    })

    const validation = validatePhone(rawPhone)

    if (!validation.isValid) {
      failedCount++
      const errorMsg = validation.error || 'Invalid phone number format'
      errors.push({
        index: i + 1,
        studentName,
        phone: rawPhone,
        error: errorMsg,
      })

      await logWhatsAppDispatch({
        studentId,
        phone: rawPhone || 'unknown',
        recipientName: studentName,
        recipientType,
        messageBody: item.message,
        status: 'failed',
        errorMessage: errorMsg,
      })

      logs.push({
        studentName,
        phone: rawPhone,
        status: 'failed',
        error: errorMsg,
      })

      // Skip delay for validation failure and continue
      continue
    }

    try {
      if (isWebhookConfigured()) {
        await sendViaWebhook(validation.normalized, item.message, {
          studentId,
          studentName,
          target: recipientType,
        })
      }

      successfulCount++

      await logWhatsAppDispatch({
        studentId,
        phone: validation.normalized,
        recipientName: studentName,
        recipientType,
        messageBody: item.message,
        status: 'sent',
        errorMessage: null,
      })

      logs.push({
        studentName,
        phone: validation.normalized,
        status: 'sent',
        error: null,
      })

      onProgress?.({
        current: i + 1,
        total,
        percent: Math.round(((i + 1) / total) * 100),
        studentName,
        phone: validation.normalized,
        currentStatus: 'sent',
        successfulCount,
        failedCount,
      })
    } catch (err) {
      failedCount++
      const errMsg = err.message || 'Webhook transmission failed'
      errors.push({
        index: i + 1,
        studentName,
        phone: validation.normalized,
        error: errMsg,
      })

      await logWhatsAppDispatch({
        studentId,
        phone: validation.normalized,
        recipientName: studentName,
        recipientType,
        messageBody: item.message,
        status: 'failed',
        errorMessage: errMsg,
      })

      logs.push({
        studentName,
        phone: validation.normalized,
        status: 'failed',
        error: errMsg,
      })

      onProgress?.({
        current: i + 1,
        total,
        percent: Math.round(((i + 1) / total) * 100),
        studentName,
        phone: validation.normalized,
        currentStatus: 'failed',
        successfulCount,
        failedCount,
        error: errMsg,
      })
    }

    // Apply rate-limiting delay between outgoing messages if there are remaining messages
    if (i < total - 1 && delayMs > 0 && !signal?.aborted && !controller?.cancelled) {
      onProgress?.({
        current: i + 1,
        total,
        percent: Math.round(((i + 1) / total) * 100),
        studentName,
        phone: validation.normalized,
        currentStatus: 'waiting_delay',
        successfulCount,
        failedCount,
        delayRemaining: delayMs,
      })
      const completed = await delayWithController(delayMs, controller)
      if (!completed) break
    }
  }

  return {
    total,
    sent: successfulCount,
    failed: failedCount,
    successfulCount,
    failedCount,
    errors,
    logs,
  }
}

/**
 * Sequential WhatsApp-Web link dispatcher (no webhook configured).
 *
 * Opens ONE https://web.whatsapp.com/send?phone=... chat at a time, waits for
 * the configured delay so the chat context loads completely, then proceeds to
 * the next recipient (Index + 1). Pause / Resume / Cancel supported through
 * the controller. Every opened chat is recorded in the whatsapp_logs table.
 *
 * @param {Array<{ phone, message, url?, studentName?, studentId?, target? }>} messages
 * @param {Object} options  { delayMs, onProgress, controller }
 * @returns {Promise<{ total, sent, failed, successfulCount, failedCount, errors, logs }>}
 */
export async function dispatchWhatsAppLinksSequentially(
  messages = [],
  {
    delayMs = 3000,
    onProgress = null,
    controller = null,
  } = {}
) {
  const total = messages.length
  let successfulCount = 0
  let failedCount = 0
  const errors = []
  const logs = []

  for (let i = 0; i < total; i++) {
    await holdWhilePaused(controller)
    if (controller?.cancelled) {
      console.log('Sequential WhatsApp dispatch cancelled by user.')
      break
    }

    const item = messages[i]
    const studentName = item.studentName || item.record?.full_name || 'Student'
    const studentId = item.studentId || item.record?.student_id || null
    const recipientType = item.target || 'student'
    const rawPhone = item.phone

    onProgress?.({
      current: i + 1,
      total,
      percent: Math.round(((i + 1) / total) * 100),
      studentName,
      phone: rawPhone,
      currentStatus: 'opening',
      successfulCount,
      failedCount,
    })

    const validation = validatePhone(rawPhone)
    const url = item.url || buildChatUrl(rawPhone, item.message)

    if (!validation.isValid || !url) {
      failedCount++
      const errorMsg = validation.error || 'Invalid phone number format'
      errors.push({ index: i + 1, studentName, phone: rawPhone, error: errorMsg })
      await logWhatsAppDispatch({
        studentId,
        phone: rawPhone || 'unknown',
        recipientName: studentName,
        recipientType,
        messageBody: item.message,
        status: 'failed',
        errorMessage: errorMsg,
      })
      logs.push({ studentName, phone: rawPhone, status: 'failed', error: errorMsg })
      continue
    }

    try {
      window.open(url, '_blank', 'noopener,noreferrer')
      successfulCount++

      await logWhatsAppDispatch({
        studentId,
        phone: validation.normalized,
        recipientName: studentName,
        recipientType,
        messageBody: item.message,
        status: 'sent',
        errorMessage: null,
      })

      logs.push({ studentName, phone: validation.normalized, status: 'sent', error: null })

      onProgress?.({
        current: i + 1,
        total,
        percent: Math.round(((i + 1) / total) * 100),
        studentName,
        phone: validation.normalized,
        currentStatus: 'sent',
        successfulCount,
        failedCount,
      })
    } catch (err) {
      failedCount++
      const errMsg = err.message || 'Could not open WhatsApp chat'
      errors.push({ index: i + 1, studentName, phone: rawPhone, error: errMsg })
      await logWhatsAppDispatch({
        studentId,
        phone: validation.normalized,
        recipientName: studentName,
        recipientType,
        messageBody: item.message,
        status: 'failed',
        errorMessage: errMsg,
      })
      logs.push({ studentName, phone: validation.normalized, status: 'failed', error: errMsg })
    }

    // Configurable delay so the current chat loads before the next recipient
    if (i < total - 1 && delayMs > 0 && !controller?.cancelled) {
      onProgress?.({
        current: i + 1,
        total,
        percent: Math.round(((i + 1) / total) * 100),
        studentName,
        phone: validation.normalized,
        currentStatus: 'waiting_delay',
        successfulCount,
        failedCount,
        delayRemaining: delayMs,
      })
      const completed = await delayWithController(delayMs, controller)
      if (!completed) break
    }
  }

  return {
    total,
    sent: successfulCount,
    failed: failedCount,
    successfulCount,
    failedCount,
    errors,
    logs,
  }
}

/** Uses the webhook when configured, otherwise falls back to the deep link. */
export async function sendReport(phone, message, meta = {}) {
  const validation = validatePhone(phone)
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid phone number')
  }

  if (isWebhookConfigured()) {
    try {
      await sendViaWebhook(validation.normalized, message, meta)
      await logWhatsAppDispatch({
        studentId: meta.studentId || null,
        phone: validation.normalized,
        recipientName: meta.studentName || '',
        recipientType: meta.target || 'student',
        messageBody: message,
        status: 'sent',
      })
      return { via: 'webhook', success: true }
    } catch (err) {
      await logWhatsAppDispatch({
        studentId: meta.studentId || null,
        phone: validation.normalized,
        recipientName: meta.studentName || '',
        recipientType: meta.target || 'student',
        messageBody: message,
        status: 'failed',
        errorMessage: err.message,
      })
      throw err
    }
  }

  openWhatsApp(validation.normalized, message)
  await logWhatsAppDispatch({
    studentId: meta.studentId || null,
    phone: validation.normalized,
    recipientName: meta.studentName || '',
    recipientType: meta.target || 'student',
    messageBody: message,
    status: 'sent',
  })
  return { via: 'wa.me', success: true }
}
