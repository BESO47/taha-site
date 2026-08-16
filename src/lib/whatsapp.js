/**
 * WhatsApp report helpers.
 *
 * Default transport is the zero-setup wa.me deep link: it opens WhatsApp
 * with the message pre-filled and the teacher taps send. If you later wire
 * up a Cloud API / webhook, set VITE_WHATSAPP_WEBHOOK_URL and sendViaWebhook
 * will post the payload there instead.
 */

/** 01012345678 -> 201012345678 (Egypt default country code). */
export function normalizePhone(raw, countryCode = '20') {
  if (!raw) return ''
  let digits = String(raw).replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith(countryCode)) return digits
  if (digits.startsWith('0')) digits = digits.slice(1)
  return `${countryCode}${digits}`
}

function pct(n) {
  const v = Number(n)
  return Number.isFinite(v) ? `${Math.round(v)}%` : '—'
}

/**
 * Build the summary message sent to a student or parent.
 * `lang` picks Arabic or English wording.
 */
export function buildReportMessage({
  studentName,
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
    L.push('')
    L.push('*ملخص الأداء:*')
    L.push(`• نسبة الحضور: ${pct(analytics.attendance_percent)} (${analytics.present_count || 0} من ${analytics.total_sessions || 0} حصة)`)
    L.push(`• عدد مرات الغياب: ${analytics.absent_count || 0}`)
    L.push(`• متوسط درجات الاختبارات: ${pct(analytics.avg_quiz_percent)} (${analytics.quiz_count || 0} اختبار)`)
    L.push(`• متوسط درجات الواجبات: ${pct(analytics.avg_assignment_percent)} (${analytics.submission_count || 0} واجب مُسلَّم)`)

    if (recentGrades.length) {
      L.push('')
      L.push('*آخر الاختبارات:*')
      recentGrades.slice(0, 5).forEach((g) => {
        const title = g.quizzes?.title || 'اختبار'
        const max = g.quizzes?.max_score || 100
        L.push(`• ${title}: ${g.score} / ${max}`)
      })
    }

    if (recentAttendance.length) {
      const map = { present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'بعذر' }
      L.push('')
      L.push('*آخر سجلات الحضور:*')
      recentAttendance.slice(0, 5).forEach((a) => {
        L.push(`• ${a.session_date}: ${map[a.status] || a.status}`)
      })
    }

    if (pendingAssignments.length) {
      L.push('')
      L.push('*واجبات لم تُسلَّم بعد:*')
      pendingAssignments.slice(0, 5).forEach((a) => L.push(`• ${a.title}`))
    }

    L.push('')
    L.push(`مع تحيات ${teacherName}`)
    L.push('physics بطريقه مختلفه')
  } else {
    L.push(`*Student Progress Report - ${platformName}*`)
    L.push(`Student: *${studentName}*`)
    L.push('')
    L.push('*Performance summary:*')
    L.push(`• Attendance: ${pct(analytics.attendance_percent)} (${analytics.present_count || 0} of ${analytics.total_sessions || 0} sessions)`)
    L.push(`• Absences: ${analytics.absent_count || 0}`)
    L.push(`• Quiz average: ${pct(analytics.avg_quiz_percent)} (${analytics.quiz_count || 0} quizzes)`)
    L.push(`• Assignment average: ${pct(analytics.avg_assignment_percent)} (${analytics.submission_count || 0} submitted)`)

    if (recentGrades.length) {
      L.push('')
      L.push('*Recent quizzes:*')
      recentGrades.slice(0, 5).forEach((g) => {
        const title = g.quizzes?.title || 'Quiz'
        const max = g.quizzes?.max_score || 100
        L.push(`• ${title}: ${g.score} / ${max}`)
      })
    }

    if (recentAttendance.length) {
      L.push('')
      L.push('*Recent attendance:*')
      recentAttendance.slice(0, 5).forEach((a) => L.push(`• ${a.session_date}: ${a.status}`))
    }

    if (pendingAssignments.length) {
      L.push('')
      L.push('*Outstanding assignments:*')
      pendingAssignments.slice(0, 5).forEach((a) => L.push(`• ${a.title}`))
    }

    L.push('')
    L.push(`Regards, ${teacherName}`)
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

const WEBHOOK_URL = import.meta.env.VITE_WHATSAPP_WEBHOOK_URL

export function isWebhookConfigured() {
  return Boolean(WEBHOOK_URL)
}

/** Optional automated path: POST the message to your own webhook / Cloud API relay. */
export async function sendViaWebhook(phone, message, meta = {}) {
  if (!WEBHOOK_URL) throw new Error('VITE_WHATSAPP_WEBHOOK_URL is not configured')

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: normalizePhone(phone), message, ...meta }),
  })

  if (!res.ok) throw new Error(`Webhook responded ${res.status}`)
  return res.json().catch(() => ({ ok: true }))
}

/** Uses the webhook when configured, otherwise falls back to the deep link. */
export async function sendReport(phone, message, meta = {}) {
  if (isWebhookConfigured()) {
    await sendViaWebhook(phone, message, meta)
    return { via: 'webhook' }
  }
  openWhatsApp(phone, message)
  return { via: 'wa.me' }
}
