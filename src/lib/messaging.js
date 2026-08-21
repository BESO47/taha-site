/**
 * Bulk WhatsApp messaging helpers for Physics Hub.
 *
 * Variables supported in templates:
 *   - {{student_name}}            : Student Full Name
 *   - {{group_name}}              : Assigned Group Name
 *   - {{last_session_attendance}} : Last Session Attendance Status
 *   - {{overall_attendance}}      : Overall Attendance (e.g. 85% (12/14))
 *   - {{last_quiz_score}}         : Latest Quiz Score (e.g. 18/20)
 *   - {{last_homework_grade}}     : Latest Homework Submission Grade (e.g. 9/10)
 */

import { normalizePhone, formatPhoneWithPlus, validatePhone } from './whatsapp'

/** The variable tags the template editor exposes. */
export const TEMPLATE_VARIABLES = [
  { key: 'student_name', labelEn: 'Student Name', labelAr: 'اسم الطالب' },
  { key: 'group_name', labelEn: 'Student Group', labelAr: 'اسم المجموعة' },
  { key: 'last_session_attendance', labelEn: 'Last Session Attendance', labelAr: 'حضور آخر حصة' },
  { key: 'overall_attendance', labelEn: 'Overall Attendance', labelAr: 'نسبة الحضور الكلية' },
  { key: 'last_quiz_score', labelEn: 'Latest Quiz Score', labelAr: 'درجة آخر اختبار' },
  { key: 'last_homework_grade', labelEn: 'Latest Homework', labelAr: 'آخر واجب' },
]

const STATUS_LABELS = {
  en: { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' },
  ar: { present: 'حاضر ✅', absent: 'غائب ❌', late: 'متأخر ⏳', excused: 'بعذر 📄' },
}

const HOMEWORK_LABELS = {
  en: {
    graded: 'Graded', submitted: 'Completed', returned: 'Returned',
    missing: 'Not submitted', none: '—',
  },
  ar: {
    graded: 'تم التصحيح ✅', submitted: 'تم التسليم 📝', returned: 'مُعاد ↩️',
    missing: 'لم يُسلَّم ⚠️', none: '—',
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
    last_quiz_score = `${fmt(record.last_quiz_score)} / ${fmt(record.last_quiz_max)}`
  }

  // ---- latest homework: "9/10" | "Completed" | "Not submitted" ----
  let last_homework_grade
  if (record.last_homework_score != null && record.last_homework_max != null) {
    last_homework_grade = `${fmt(record.last_homework_score)} / ${fmt(record.last_homework_max)}`
  } else if (record.last_homework_status) {
    last_homework_grade = hwLabels[record.last_homework_status] || record.last_homework_status
  } else {
    last_homework_grade = hwLabels.none
  }

  return {
    student_name: record.full_name || '',
    group_name: record.group_name || (lang === 'ar' ? 'عام' : 'General'),
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
 * Phone is normalised with the standard helper (+20 default).
 */
export function buildWhatsAppUrl(phone, message) {
  const to = normalizePhone(phone)
  if (!to) return null
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`
}

/**
 * Compile the template for every selected student.
 * @returns {Array<{ record, phone, formattedPhone, isValid, error, message, url }>}
 */
export function buildBulkMessages(records, template, { lang = 'ar', attendance = 'both', recipientType = 'student' } = {}) {
  const out = []
  for (const record of records) {
    const rawPhone = String(record.phone || '').trim()
    if (!rawPhone) continue

    const val = validatePhone(rawPhone)
    const values = buildVariableValues(record, { lang, attendance })
    const message = compileTemplate(template, values)
    const url = val.isValid ? buildWhatsAppUrl(val.normalized, message) : null

    out.push({
      record,
      studentName: record.full_name || 'Student',
      studentId: record.student_id || record.id,
      phone: val.normalized || rawPhone,
      formattedPhone: val.formatted || rawPhone,
      isValid: val.isValid,
      error: val.error,
      target: recipientType,
      message,
      url,
    })
  }
  return out
}
