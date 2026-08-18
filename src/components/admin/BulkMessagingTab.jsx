import { useState, useEffect, useCallback, useRef } from 'react'
import {
  MessageCircle, Users, Loader2, Send, Copy, Check, ExternalLink,
  Filter, Sparkles, CheckSquare, Square, PhoneOff,
} from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/dummyData'
import { fetchBulkMessagingReport } from '../../lib/api'
import { isWebhookConfigured, sendViaWebhook } from '../../lib/whatsapp'
import {
  TEMPLATE_VARIABLES, buildVariableValues, buildBulkMessages,
} from '../../lib/messaging'

const DEFAULT_TEMPLATE_AR = [
  'مرحباً {{student_name}} 👋',
  '',
  'تقرير متابعتك في Physics Hub:',
  '• حضور آخر حصة: {{last_session_attendance}}',
  '• نسبة الحضور الكلية: {{overall_attendance}}',
  '• درجة آخر اختبار: {{last_quiz_score}}',
  '• آخر واجب: {{last_homework_grade}}',
  '',
  'مع تحيات م. طه الصباغ',
].join('\n')

const DEFAULT_TEMPLATE_EN = [
  'Hi {{student_name}} 👋',
  '',
  'Your Physics Hub progress report:',
  '• Last session attendance: {{last_session_attendance}}',
  '• Overall attendance: {{overall_attendance}}',
  '• Latest quiz score: {{last_quiz_score}}',
  '• Latest homework: {{last_homework_grade}}',
  '',
  'Regards, Eng. Taha Elsabagh',
].join('\n')

const PILL = {
  present: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  absent: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
  late: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  excused: 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400',
}

const ATT_STATUS = { en: { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' }, ar: { present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'بعذر' } }

function Bar({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className="h-1.5 w-16 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${v}%` }} />
    </div>
  )
}

export default function BulkMessagingTab() {
  const { t, lang } = useLanguage()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [recipient, setRecipient] = useState('student')
  const [attendanceFormat, setAttendanceFormat] = useState('both')
  const [selected, setSelected] = useState(() => new Set())
  const [template, setTemplate] = useState(lang === 'ar' ? DEFAULT_TEMPLATE_AR : DEFAULT_TEMPLATE_EN)
  const [review, setReview] = useState(null)
  const [sending, setSending] = useState(false)
  const [sentCount, setSentCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const editorRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setRecords(await fetchBulkMessagingReport({ yearId: null }))
    } catch (err) {
      console.error(err)
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // keep the default template in sync with the active language (only until the
  // teacher edits it — editing wins).
  const [edited, setEdited] = useState(false)
  useEffect(() => {
    if (!edited) setTemplate(lang === 'ar' ? DEFAULT_TEMPLATE_AR : DEFAULT_TEMPLATE_EN)
  }, [lang, edited])

  const visible = records.filter((r) => yearFilter === 'all' || r.year_id === yearFilter)

  const phoneFor = (r) => (recipient === 'parent' ? r.parent_phone || r.phone : r.phone)

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.student_id))

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visible.forEach((r) => next.delete(r.student_id))
      else visible.forEach((r) => next.add(r.student_id))
      return next
    })

  const insertVariable = (key) => {
    const el = editorRef.current
    if (!el) return
    const tag = `{{${key}}}`
    const start = el.selectionStart ?? template.length
    const end = el.selectionEnd ?? template.length
    const next = template.slice(0, start) + tag + template.slice(end)
    setTemplate(next)
    setEdited(true)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + tag.length, start + tag.length)
    })
  }

  const chosenRecords = visible.filter((r) => selected.has(r.student_id))
  const previewRecord = chosenRecords[0] || visible[0]

  const previewValues = previewRecord
    ? buildVariableValues(previewRecord, { lang, attendance: attendanceFormat })
    : null

  const handleSend = async () => {
    if (!chosenRecords.length) {
      alert(t('noSelection'))
      return
    }
    const messages = buildBulkMessages(
      chosenRecords.map((r) => ({ ...r, phone: phoneFor(r) })),
      template,
      { lang, attendance: attendanceFormat }
    )
    if (!messages.length) {
      alert(lang === 'ar' ? 'لا يوجد رقم هاتف للمستلمين المحددين.' : 'No phone number for the selected recipients.')
      return
    }

    if (isWebhookConfigured()) {
      setSending(true)
      try {
        let ok = 0
        for (const m of messages) {
          await sendViaWebhook(m.phone, m.message, { studentId: m.record.student_id, target: recipient })
          ok++
        }
        setSentCount(ok)
      } catch (err) {
        alert(err.message)
      } finally {
        setSending(false)
      }
      return
    }

    // manual wa.me path -> open a review sheet with the generated links
    setReview(messages)
  }

  const openAll = () => {
    if (!review) return
    review.forEach((m, i) => {
      setTimeout(() => window.open(m.url, '_blank', 'noopener,noreferrer'), i * 650)
    })
  }

  const copyAllLinks = async () => {
    if (!review) return
    await navigator.clipboard.writeText(review.map((m) => m.url).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const statusLabel = (s) => (ATT_STATUS[lang] || ATT_STATUS.en)[s] || s || '—'

  return (
    <div className="space-y-6">
      {/* ---------- controls ---------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-5">
        <div className="flex items-center gap-2 font-bold text-lg">
          <MessageCircle className="w-5 h-5 text-green-500" />
          <span>{t('bulkMessagingTitle')}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* grade dropdown */}
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('selectGrade')}</label>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            >
              <option value="all">{t('allGrades')}</option>
              {YEARS.map((y) => (
                <option key={y.id} value={y.id}>{lang === 'ar' ? y.titleAr : y.title}</option>
              ))}
            </select>
          </div>

          {/* recipient */}
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('recipient')}</label>
            <select
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            >
              <option value="student">{t('recipientStudent')}</option>
              <option value="parent">{t('recipientParent')}</option>
            </select>
          </div>

          {/* attendance format */}
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('attendanceFormat')}</label>
            <select
              value={attendanceFormat}
              onChange={(e) => setAttendanceFormat(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            >
              <option value="both">{t('attendanceBoth')}</option>
              <option value="percent">{t('attendancePercent')}</option>
              <option value="ratio">{t('attendanceRatio')}</option>
            </select>
          </div>

          {/* bulk action */}
          <div className="flex items-end">
            <button
              onClick={handleSend}
              disabled={sending || !chosenRecords.length}
              className="w-full px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{t('sendBulk')} {chosenRecords.length > 0 ? `(${chosenRecords.length})` : ''}</span>
            </button>
          </div>
        </div>

        {sentCount > 0 && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-sm font-bold text-center">
            {sentCount} {t('bulkSentWebhook')} ✅
          </div>
        )}

        {loadError && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm font-bold">
            {loadError}
          </div>
        )}
      </div>

      {/* ---------- template editor ---------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <h3 className="font-bold text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-yellow-500" />
          <span>{t('templateEditor')}</span>
        </h3>

        <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">{t('templateHint')}</p>

        {/* variable chips */}
        <div className="flex flex-wrap gap-2">
          {TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v.key}
              onClick={() => insertVariable(v.key)}
              className="px-3 py-1.5 rounded-lg bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300 text-xs font-bold font-mono hover:bg-yellow-100 transition"
              dir="ltr"
            >
              {`{{${v.key}}}`}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <textarea
            ref={editorRef}
            value={template}
            onChange={(e) => { setTemplate(e.target.value); setEdited(true) }}
            rows={10}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-mono leading-relaxed resize-y"
            dir="auto"
          />

          {/* live preview */}
          <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-black/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-500">{t('livePreview')}</h4>
              <span className="text-[10px] text-slate-400">{t('previewHint')}</span>
            </div>
            <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 whitespace-pre-wrap text-sm leading-relaxed">
              {previewValues ? (
                (() => {
                  // reuse compileTemplate through buildBulkMessages on the single preview row
                  const single = buildBulkMessages([{ ...previewRecord, phone: previewRecord.phone || previewRecord.parent_phone || 'x' }], template, { lang, attendance: attendanceFormat })
                  return single[0]?.message || '—'
                })()
              ) : (
                '—'
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <ExternalLink className="w-3.5 h-3.5" />
              <span dir="ltr" className="font-mono truncate">wa.me/…?text=…</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- student table ---------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Users className="w-5 h-5 text-yellow-500" />
            <span>
              {lang === 'ar' ? `الطلاب (${visible.length})` : `Students (${visible.length})`}
              {' · '}
              {chosenRecords.length} {t('selectedOf')}
            </span>
          </h3>
          <button
            onClick={toggleAll}
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 text-xs font-bold flex items-center gap-1.5"
          >
            {allVisibleSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            <span>{t('selectAll')}</span>
          </button>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
        ) : visible.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-12 flex items-center justify-center gap-2">
            <Filter className="w-4 h-4" /> {t('noStudentsFound')}
          </p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-[11px] text-slate-400 text-start border-b border-slate-200 dark:border-zinc-800">
                  <th className="p-2 w-10"></th>
                  <th className="p-2 text-start font-bold">{t('student')}</th>
                  <th className="p-2 text-start font-bold">{t('phoneCol')}</th>
                  <th className="p-2 text-start font-bold">{t('lastSession')}</th>
                  <th className="p-2 text-start font-bold">{t('attendanceCol')}</th>
                  <th className="p-2 text-start font-bold">{t('latestQuiz')}</th>
                  <th className="p-2 text-start font-bold">{t('latestHomework')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const checked = selected.has(r.student_id)
                  const phone = phoneFor(r)
                  return (
                    <tr
                      key={r.student_id}
                      onClick={() => toggle(r.student_id)}
                      className={`border-b border-slate-100 dark:border-zinc-800/60 cursor-pointer transition ${
                        checked ? 'bg-yellow-50 dark:bg-yellow-950/20' : 'hover:bg-slate-50 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <td className="p-2">
                        {checked ? (
                          <CheckSquare className="w-5 h-5 text-yellow-500" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-300 dark:text-zinc-600" />
                        )}
                      </td>
                      <td className="p-2 font-bold whitespace-nowrap">
                        {r.full_name}
                        {r.is_active === false && <span className="ms-1 text-[10px] text-red-400">(inactive)</span>}
                      </td>
                      <td className="p-2 font-mono text-xs text-slate-500 whitespace-nowrap" dir="ltr">
                        {phone || <PhoneOff className="w-3.5 h-3.5 inline text-red-400" />}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {r.last_session_attendance ? (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PILL[r.last_session_attendance] || PILL.excused}`}>
                            {statusLabel(r.last_session_attendance)}
                          </span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold">{r.attendance_percent ?? 0}%</span>
                          <Bar value={r.attendance_percent} />
                        </div>
                      </td>
                      <td className="p-2 whitespace-nowrap font-mono text-xs">
                        {r.last_quiz_score != null && r.last_quiz_max != null
                          ? `${r.last_quiz_score}/${r.last_quiz_max}`
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2 whitespace-nowrap font-mono text-xs">
                        {r.last_homework_score != null && r.last_homework_max != null
                          ? `${r.last_homework_score}/${r.last_homework_max}`
                          : r.last_homework_status
                            ? statusLabel(r.last_homework_status)
                            : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- review modal (wa.me links) ---------- */}
      {review && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-3xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-green-500" />
                <span>{t('reviewMessages')} ({review.length})</span>
              </h3>
              <button onClick={() => setReview(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            <p className="text-xs text-slate-500 dark:text-zinc-400">{t('reviewHint')}</p>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={openAll}
                className="px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-bold flex items-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                <span>{t('openAllWhatsApp')}</span>
              </button>
              <button
                onClick={copyAllLinks}
                className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-bold flex items-center gap-2"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? t('copied') : t('copyAllLinks')}</span>
              </button>
            </div>

            <div className="space-y-2">
              {review.map((m, i) => (
                <div key={m.record.student_id + i} className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{m.record.full_name}</p>
                    <p className="text-[11px] text-slate-500 font-mono truncate" dir="ltr">{m.phone}</p>
                    <p className="text-[11px] text-slate-400 whitespace-pre-wrap line-clamp-2">{m.message}</p>
                  </div>
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{t('openLink')}</span>
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
