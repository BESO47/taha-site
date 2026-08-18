/**
 * Bulk WhatsApp messaging helpers.
 *
 * These are the building blocks behind the BulkMessagingTab component:
 *   - TEMPLATE_VARIABLES  : the {{...}} tags the editor can insert
 *   - buildVariableValues : turn one student record (from the
 *     `bulk_messaging_report` RPC, or its client-side fallback) into a
 *     map of variable -> human readable string
 *   - compileTemplate     : replace {{tags}} in the user's message
 *   - buildWhatsAppUrl    : wa.me/<phone>?text=<urlencoded_message>
 *   - buildBulkMessages   : compile the template for every selected
 *     student and produce { phone, message, url } entries ready to send
 *
 * A record has this shape (see bulk-messaging.sql / fetchBulkMessagingReport):
 * {
 *   student_id, full_name, phone, parent_phone, year_id, is_active,
 *   total_sessions, present_count, absent_count, late_count, attendance_percent,
 *   last_session_date, last_session_attendance,
 *   last_quiz_title, last_quiz_date, last_quiz_score, last_quiz_max,
 *   last_homework_title, last_homework_status, last_homework_score, last_homework_max
 * }
 */

/** The variable tags the template editor exposes. */
export const TEMPLATE_VARIABLES = [
  { key: 'student_name', labelEn: 'Student Name', labelAr: 'اسم الطالب' },
  { key: 'last_session_attendance', labelEn: 'Last Session Attendance', labelAr: 'حضور آخر حصة' },
  { key: 'overall_attendance', labelEn: 'Overall Attendance', labelAr: 'نسبة الحضور الكلية' },
  { key: 'last_quiz_score', labelEn: 'Latest Quiz Score', labelAr: 'درجة آخر اختبار' },
  { key: 'last_homework_grade', labelEn: 'Latest Homework', labelAr: 'آخر واجب' },
]

const STATUS_LABELS = {
  en: { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' },
  ar: { present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'بعذر' },
}

const HOMEWORK_LABELS = {
  en: {
    graded: 'Graded', submitted: 'Completed', returned: 'Returned',
    missing: 'Not submitted', none: '—',
  },
  ar: {
    graded: 'تم التصحيح', submitted: 'تم التسليم', returned: 'مُعاد',
    missing: 'لم يُسلَّم', none: '—',
  },
}

const fmt = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)
}

/**
 * Build the map of variable -> string for one student record.
 * @param {object} record  one row from bulk_messaging_report / fallback
 * @param {object} opts    { lang: 'ar'|'en', attendance: 'percent'|'ratio'|'both' }
 */
export function buildVariableValues(record = {}, { lang = 'ar', attendance = 'both' } = {}) {
  const statusLabels = STATUS_LABELS[lang] || STATUS_LABELS.ar
  const hwLabels = HOMEWORK_LABELS[lang] || HOMEWORK_LABELS.ar

  // ---- overall attendance: "85% (12/14)" / "85%" / "12/14" ----
  const total = Number(record.total_sessions) || 0
  const attended = (Number(record.present_count) || 0) + (Number(record.late_count) || 0)
  const pct = record.attendance_percent != null ? `${fmt(record.attendance_percent)}%` : null

  let overall_attendance
  if (!total) {
    overall_attendance = '—'
  } else if (attendance === 'percent') {
    overall_attendance = pct
  } else if (attendance === 'ratio') {
    overall_attendance = `${attended}/${total}`
  } else {
    overall_attendance = `${pct} (${attended}/${total})`
  }

  // ---- last session attendance ----
  const last_session_attendance = record.last_session_attendance
    ? statusLabels[record.last_session_attendance] || record.last_session_attendance
    : '—'

  // ---- latest quiz: "18/20" ----
  let last_quiz_score = '—'
  if (record.last_quiz_score != null && record.last_quiz_max != null) {
    last_quiz_score = `${fmt(record.last_quiz_score)}/${fmt(record.last_quiz_max)}`
  }

  // ---- latest homework: "9/10" | "Completed" | "Not submitted" ----
  let last_homework_grade
  if (record.last_homework_score != null && record.last_homework_max != null) {
    last_homework_grade = `${fmt(record.last_homework_score)}/${fmt(record.last_homework_max)}`
  } else if (record.last_homework_status) {
    last_homework_grade = hwLabels[record.last_homework_status] || record.last_homework_status
  } else {
    last_homework_grade = hwLabels.none
  }

  return {
    student_name: record.full_name || '',
    last_session_attendance,
    overall_attendance,
    last_quiz_score,
    last_homework_grade,
  }
}

/** Replace every {{variable}} tag in a template string. Unknown tags stay as-is. */
export function compileTemplate(template, values) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    return values[key] != null && values[key] !== '' ? String(values[key]) : match
  })
}

/**
 * https://wa.me/<phone>?text=<urlencoded_message>
 * Phone is normalised with the existing helper (Egypt default +20).
 */
export function buildWhatsAppUrl(phone, message) {
  // local import avoids a circular dependency on lib/whatsapp.js
  // eslint-disable-next-line global-require
  const to = normalizePhoneLocal(phone)
  if (!to) return null
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`
}

/** Keep this self-contained so messaging.js has no import cycle. */
function normalizePhoneLocal(raw, countryCode = '20') {
  if (!raw) return ''
  let digits = String(raw).replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith(countryCode)) return digits
  if (digits.startsWith('0')) digits = digits.slice(1)
  return `${countryCode}${digits}`
}

/**
 * Compile the template for every selected student.
 * @returns {Array<{ record, phone, message, url }>}  (rows without a phone are skipped)
 */
export function buildBulkMessages(records, template, { lang = 'ar', attendance = 'both' } = {}) {
  const out = []
  for (const record of records) {
    const phone = String(record.phone || '').trim()
    if (!phone) continue
    const message = compileTemplate(template, buildVariableValues(record, { lang, attendance }))
    const url = buildWhatsAppUrl(phone, message)
    if (!url) continue
    out.push({ record, phone, message, url })
  }
  return out
}
