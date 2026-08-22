/**
 * WhatsApp integration & bulk messaging engine for Physics Hub.
 *
 * Features:
 *   - Universal phone normalization & strict validation (Egypt +20 / International).
 *   - Safe rate limiting / async dispatch queue (2-5s per message) to prevent bans.
 *   - Authenticated server gateway or manual wa.me delivery (no browser secrets).
 *   - Comprehensive database logging to `whatsapp_logs` table with delivery status.
 *   - Rich report generation for student progress.
 */

import { supabase, isSupabaseConfigured } from './supabase'
import {
  isGatewayConfigured,
  pingGateway,
  getGatewayStatus,
  startBulkJob,
  waitForJob,
  cancelJob as cancelGatewayJob,
  pauseJob as pauseGatewayJob,
  resumeJob as resumeGatewayJob,
  sendSingleMessage,
} from './whatsappGateway'
import { normalizePhone, validatePhone, buildChatUrl } from './phoneCore.js'

// Phone normalization/validation and URL builders live in the dependency-free
// `phoneCore.js` (unit-testable in Node). Re-exported here so every existing
// consumer of `lib/whatsapp.js` keeps working unchanged.
export {
  normalizePhone,
  formatPhoneWithPlus,
  validatePhone,
  isMobileDevice,
  buildChatUrl,
  buildNativeWhatsAppUrl,
} from './phoneCore.js'

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

/** Open WhatsApp with the message pre-filled (one recipient). */
export function openWhatsApp(phone, message) {
  const to = normalizePhone(phone)
  if (!to) throw new Error('Missing or invalid phone number')
  const url = buildChatUrl(to, message)
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened && isMobileDevice()) {
    window.location.href = url
  }
  return url
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

/** Helper sleep function for rate limiting / delay */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const LOG_STORAGE_KEY = 'physics_hub_whatsapp_logs'
const LOG_BATCH_SIZE = 200

/** Normalize one log entry into the whatsapp_logs row shape. */
function buildLogRow({
  studentId = null,
  phone,
  recipientName = '',
  recipientType = 'student',
  messageBody = '',
  status = 'sent',
  errorMessage = null,
}) {
  return {
    student_id: studentId || null,
    phone: normalizePhone(phone),
    recipient_name: recipientName || null,
    recipient_type: recipientType || 'student',
    message_body: messageBody,
    status,
    error_message: errorMessage || null,
    sent_at: new Date().toISOString(),
  }
}

/**
 * Persist log rows. In offline/demo mode they are prepended to a bounded
 * localStorage list; otherwise they are inserted into Supabase in chunks so
 * a campaign with thousands of recipients costs a handful of requests
 * instead of one HTTP round-trip per message.
 */
async function persistLogRows(rows) {
  if (!rows.length) return

  if (!isSupabaseConfigured()) {
    // Keep personal message history out of browser storage in configured
    // deployments. Local history exists only for explicit offline/demo mode.
    try {
      const existing = JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]')
      const stamped = rows.map((row, i) => ({
        id: `log_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
        ...row,
      }))
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify([...stamped, ...existing].slice(0, 200)))
    } catch (_) {}
    return
  }

  for (let i = 0; i < rows.length; i += LOG_BATCH_SIZE) {
    const { error } = await supabase
      .from('whatsapp_logs')
      .insert(rows.slice(i, i + LOG_BATCH_SIZE))
    if (error) throw error
  }
}

/**
 * Log a single WhatsApp outgoing message status to `whatsapp_logs`.
 */
export async function logWhatsAppDispatch(entry) {
  try {
    await persistLogRows([buildLogRow(entry)])
  } catch (err) {
    console.warn('Failed to insert into whatsapp_logs table:', err)
  }
}

/**
 * Batched variant for bulk campaigns: one call for the whole job result.
 * Logging failures never fail the campaign itself.
 */
export async function logBulkDispatches(entries = []) {
  try {
    await persistLogRows(entries.map(buildLogRow))
  } catch (err) {
    console.warn('Failed to batch-insert into whatsapp_logs table:', err)
  }
}

/**
 * Fetch WhatsApp delivery logs from Supabase / localStorage.
 */
export async function fetchWhatsAppLogs({ limit = 50 } = {}) {
  if (isSupabaseConfigured()) {
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50))
    const { data, error } = await supabase
      .from('whatsapp_logs')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(safeLimit)
    if (error) throw error
    return data || []
  }

  // Fallback to local storage
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY)
    if (raw) return JSON.parse(raw).slice(0, limit)
  } catch (err) {}

  return []
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
      errors.push({ index: i + 1, studentId, studentName, phone: rawPhone, error: errorMsg })
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
      // Browsers only allow ONE popup per user gesture: every window.open
      // after the first is silently blocked and returns null. Detect it
      // instead of reporting a fake success.
      const opened = window.open(url, '_blank')
      if (!opened) {
        throw new Error(
          'Popup blocked by the browser. Allow popups for this site, or use the ' +
          'WhatsApp gateway for fully automatic sending.'
        )
      }
      // Detach the opener before the remote page loads (reverse-tabnabbing).
      try { opened.opener = null } catch (_) {}
      successfulCount++

      await logWhatsAppDispatch({
        studentId,
        phone: validation.normalized,
        recipientName: studentName,
        recipientType,
        messageBody: item.message,
        status: 'pending', // browser opened the chat; delivery is not confirmable
        errorMessage: null,
      })

      logs.push({ studentName, phone: validation.normalized, status: 'opened', error: null })

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
      errors.push({ index: i + 1, studentId, studentName, phone: rawPhone, error: errMsg })
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

/** Open a manual wa.me report when the authenticated gateway is unavailable. */
export async function sendReport(phone, message, meta = {}) {
  const validation = validatePhone(phone)
  if (!validation.isValid) throw new Error(validation.error || 'Invalid phone number')

  openWhatsApp(validation.normalized, message)
  await logWhatsAppDispatch({
    studentId: meta.studentId || null,
    phone: validation.normalized,
    recipientName: meta.studentName || '',
    recipientType: meta.target || 'student',
    messageBody: message,
    status: 'pending', // opening wa.me does not prove provider delivery
  })
  return { via: 'wa.me', success: true }
}

/* =====================================================================
 * GATEWAY MODE  (recommended — fully automatic bulk sending)
 * ---------------------------------------------------------------------
 * The heavy lifting happens in the Node service under `server/`:
 * it owns the WhatsApp session (whatsapp-web.js / Meta Cloud API /
 * relay), paces the queue and retries transient failures. The browser
 * only creates a job and polls its progress, so closing the dashboard
 * no longer kills a campaign.
 * ===================================================================== */

/**
 * Which transport will actually be used right now?
 * @returns {Promise<{ mode:'gateway'|'manual', ready:boolean, status:object|null, reason:string }>}
 */
export async function resolveTransport() {
  if (isGatewayConfigured()) {
    const health = await pingGateway()
    if (health) {
      try {
        const status = await getGatewayStatus()
        return {
          mode: 'gateway',
          ready: Boolean(status.ready),
          status,
          reason: status.ready
            ? `Connected via ${status.provider}`
            : status.needsScan
              ? 'Scan the QR code to link WhatsApp'
              : status.lastError || `Session state: ${status.status}`,
        }
      } catch (err) {
        return { mode: 'gateway', ready: false, status: null, reason: err.message }
      }
    }
  }

  return {
    mode: 'manual',
    ready: true,
    status: null,
    reason: 'No gateway detected — messages open one by one in WhatsApp Web',
  }
}

/** Normalize a gateway job into the summary shape the UI already renders. */
function jobToSummary(job) {
  const results = job.results || []
  return {
    jobId: job.id,
    status: job.status,
    total: job.total,
    sent: job.sent,
    failed: job.failed,
    skipped: job.skipped,
    successfulCount: job.sent,
    failedCount: job.failed,
    errors: results
      .filter((r) => r.status === 'failed')
      .map((r) => ({ index: r.index + 1, studentId: r.studentId || null, studentName: r.name, phone: r.phone, error: r.error })),
    logs: results.map((r) => ({
      studentName: r.name,
      phone: r.normalizedPhone || r.phone,
      status: r.status,
      error: r.error,
      attempts: r.attempts,
    })),
  }
}

/**
 * Run a bulk campaign through the gateway.
 *
 * @param {Array<{phone,message,studentId?,studentName?,target?,record?}>} messages
 * @param {object}   options
 * @param {number}   options.delayMs      base delay between messages
 * @param {number}   options.jitterMs     random extra delay
 * @param {boolean}  options.dryRun       validate & rehearse without sending
 * @param {Function} options.onProgress   ({ current, total, percent, ... })
 * @param {Function} options.onJob        receives the job id as soon as it exists
 * @param {AbortSignal} options.signal    stop polling
 */
export async function dispatchBulkViaGateway(
  messages = [],
  { delayMs = 4000, jitterMs = 2000, dryRun = false, onProgress = null, onJob = null, signal = null } = {}
) {
  if (!messages.length) throw new Error('No recipients selected')

  const job = await startBulkJob(messages, { delayMs, jitterMs, dryRun })
  onJob?.(job)

  const finished = await waitForJob(job.id, {
    signal,
    onProgress: (j) => {
      const idx = j.current?.index ?? Math.max(0, j.processed - 1)
      onProgress?.({
        jobId: j.id,
        current: Math.min(j.processed + (j.current ? 1 : 0), j.total),
        total: j.total,
        percent: j.percent,
        studentName: j.current?.name || '',
        phone: j.current?.phone || '',
        currentStatus:
          j.status === 'paused' ? 'paused'
            : j.current?.status === 'waiting' ? 'waiting_delay'
              : j.current?.status === 'batch_pause' ? 'batch_pause'
                : j.current?.status || j.status,
        successfulCount: j.sent,
        failedCount: j.failed,
        index: idx,
      })
    },
  })

  // Mirror the outcome into whatsapp_logs so the History modal stays useful.
  // Batched: thousands of results cost ceil(n/200) requests, not one-each.
  // Dry runs are rehearsals: they must NOT write delivery history.
  if (!finished.dryRun) {
    await logBulkDispatches(
      (finished.results || []).map((r) => ({
      studentId: r.studentId || null,
      phone: r.normalizedPhone || r.phone,
      recipientName: r.name,
      recipientType: r.recipientType || 'student',
        messageBody: messages[r.index]?.message || '',
        status: r.status === 'sent' ? 'sent' : 'failed',
        errorMessage: r.error || null,
      }))
    )
  }

  return jobToSummary(finished)
}

/** Pause / resume / cancel a running gateway campaign. */
export const gatewayControls = {
  pause: (jobId) => pauseGatewayJob(jobId),
  resume: (jobId) => resumeGatewayJob(jobId),
  cancel: (jobId) => cancelGatewayJob(jobId),
}

/**
 * Send a single message through the best available transport.
 * Order: authenticated gateway -> wa.me deep link.
 */
export async function sendMessageSmart(phone, message, meta = {}) {
  const validation = validatePhone(phone)
  if (!validation.isValid) throw new Error(validation.error || 'Invalid phone number')

  const transport = await resolveTransport()

  if (transport.mode === 'gateway' && transport.ready) {
    try {
      const res = await sendSingleMessage({ phone: validation.normalized, message, meta })
      await logWhatsAppDispatch({
        studentId: meta.studentId || null,
        phone: validation.normalized,
        recipientName: meta.studentName || '',
        recipientType: meta.target || 'student',
        messageBody: message,
        status: 'sent',
      })
      return { via: 'gateway', success: true, messageId: res.id }
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

  return sendReport(validation.normalized, message, meta)
}
