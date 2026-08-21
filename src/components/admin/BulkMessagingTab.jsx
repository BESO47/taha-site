import { useState, useEffect, useCallback, useRef } from 'react'
import {
  MessageCircle, Users, Loader2, Send, Copy, Check, ExternalLink,
  Filter, CheckSquare, Square, PhoneOff, Clock, ShieldCheck,
  AlertTriangle, History, RefreshCw, X, FileText, CheckCircle2, XCircle,
  Pause, Play, Ban
} from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/dummyData'
import { fetchBulkMessagingReport, fetchGroups } from '../../lib/api'
import {
  isWebhookConfigured,
  dispatchBulkWhatsAppQueue,
  dispatchWhatsAppLinksSequentially,
  createQueueController,
  fetchWhatsAppLogs,
  validatePhone,
  normalizePhone,
  formatPhoneWithPlus
} from '../../lib/whatsapp'
import GroupFilterSelect, { getInitialGroupFilter } from './GroupFilterSelect.jsx'
import {
  TEMPLATE_VARIABLES,
  buildVariableValues,
  buildBulkMessages,
} from '../../lib/messaging'

const DEFAULT_TEMPLATE_AR = [
  'مرحباً {{student_name}} 👋',
  '',
  'تقرير متابعتك في Physics Hub (مجموعة: {{group_name}}):',
  '• حضور آخر حصة: {{last_session_attendance}}',
  '• نسبة الحضور الكلية: {{overall_attendance}}',
  '• درجة آخر اختبار: {{last_quiz_score}}',
  '• آخر واجب: {{last_homework_grade}}',
  '',
  'مع تحيات م. طه الصباغ ⚡',
].join('\n')

const DEFAULT_TEMPLATE_EN = [
  'Hi {{student_name}} 👋',
  '',
  'Your Physics Hub progress report (Group: {{group_name}}):',
  '• Last session attendance: {{last_session_attendance}}',
  '• Overall attendance: {{overall_attendance}}',
  '• Latest quiz score: {{last_quiz_score}}',
  '• Latest homework: {{last_homework_grade}}',
  '',
  'Regards, Eng. Taha Elsabagh ⚡',
].join('\n')

const PILL = {
  present: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  absent: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
  late: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  excused: 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400',
}

const ATT_STATUS = {
  en: { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' },
  ar: { present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'بعذر' },
}

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
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Filters
  const [yearFilter, setYearFilter] = useState('all')
  const [groupId, setGroupId] = useState(() => getInitialGroupFilter())
  const [recipient, setRecipient] = useState('student')
  const [attendanceFormat, setAttendanceFormat] = useState('both')
  const [selected, setSelected] = useState(() => new Set())

  // Delay & Rate Limiting (2 to 5 seconds)
  const [delaySec, setDelaySec] = useState(3)

  // Template State
  const [template, setTemplate] = useState(lang === 'ar' ? DEFAULT_TEMPLATE_AR : DEFAULT_TEMPLATE_EN)
  const [edited, setEdited] = useState(false)
  const editorRef = useRef(null)

  // Dispatch Progress State (sequential queue with pause/cancel)
  const [isDispatching, setIsDispatching] = useState(false)
  const [progressState, setProgressState] = useState(null)
  const abortControllerRef = useRef(null)
  const queueControllerRef = useRef(null)

  // Summary Result Modal State
  const [dispatchSummary, setDispatchSummary] = useState(null)

  // Manual Review (wa.me) Modal State
  const [review, setReview] = useState(null)
  const [copied, setCopied] = useState(false)

  // Logs History Modal State
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [logsList, setLogsList] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [reportRows, allGroups] = await Promise.all([
        fetchBulkMessagingReport({ yearId: null }),
        fetchGroups(),
      ])
      setRecords(reportRows)
      setGroups(allGroups)
    } catch (err) {
      console.error(err)
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!edited) {
      setTemplate(lang === 'ar' ? DEFAULT_TEMPLATE_AR : DEFAULT_TEMPLATE_EN)
    }
  }, [lang, edited])

  const phoneFor = (r) => (recipient === 'parent' ? r.parent_phone || r.phone : r.phone)

  // Resolve the universal group filter (id -> name) for record filtering
  const selectedGroupName = groups.find((g) => g.id === groupId)?.name || null

  // Filter records by grade and group
  const visible = records.filter((r) => {
    const matchYear = yearFilter === 'all' || String(r.year_id) === String(yearFilter)
    const matchGroup = !selectedGroupName || (r.group_name || r.groupName) === selectedGroupName
    return matchYear && matchGroup
  })

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

  // =========================================================================
  // FEATURE 4: BULK DISPATCH WITH DELAY / RATE LIMITING & AUDIT LOGGING
  // =========================================================================
  const handleStartDispatch = async () => {
    if (!chosenRecords.length) {
      alert(t('noSelection'))
      return
    }

    const messages = buildBulkMessages(
      chosenRecords.map((r) => ({ ...r, phone: phoneFor(r) })),
      template,
      { lang, attendance: attendanceFormat, recipientType: recipient }
    )

    if (!messages.length) {
      alert(lang === 'ar' ? 'لا يوجد أرقام هواتف مسجلة للطلاب المحددين.' : 'No phone numbers found for the selected recipients.')
      return
    }

    // Sequential dispatch queue: recipients are processed ONE BY ONE
    // (Index + 1) with the configured delay between sends.
    await handleStartDispatchWithMessages(messages)
  }

  /** Open the review sheet (manual links) without starting the queue. */
  const handleReviewMessages = async () => {
    if (!chosenRecords.length) {
      alert(t('noSelection'))
      return
    }
    const messages = buildBulkMessages(
      chosenRecords.map((r) => ({ ...r, phone: phoneFor(r) })),
      template,
      { lang, attendance: attendanceFormat, recipientType: recipient }
    )
    if (!messages.length) {
      alert(lang === 'ar' ? 'لا يوجد أرقام هواتف مسجلة للطلاب المحددين.' : 'No phone numbers found for the selected recipients.')
      return
    }
    setReview(messages)
  }

  const handleCancelDispatch = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort()
    if (queueControllerRef.current) queueControllerRef.current.cancel()
    setIsDispatching(false)
    setProgressState(null)
    queueControllerRef.current = null
  }

  const handlePauseDispatch = () => {
    queueControllerRef.current?.pause()
    setProgressState((prev) => (prev ? { ...prev, currentStatus: 'paused' } : prev))
  }

  const handleResumeDispatch = () => {
    queueControllerRef.current?.resume()
    setProgressState((prev) => (prev ? { ...prev, currentStatus: 'resuming' } : prev))
  }

  /** Start the sequential dispatch from the review sheet (manual mode). */
  const startSequentialFromReview = async () => {
    if (!review || !review.length) return
    const messages = review
    setReview(null)
    setDispatchSummary(null)
    await handleStartDispatchWithMessages(messages)
  }

  /** Shared dispatcher used by both the main button and the review sheet. */
  const handleStartDispatchWithMessages = async (messages) => {
    if (!messages.length) {
      alert(t('noSelection'))
      return
    }
    if (isWebhookConfigured()) {
      setIsDispatching(true)
      queueControllerRef.current = createQueueController()
      abortControllerRef.current = new AbortController()
      try {
        const result = await dispatchBulkWhatsAppQueue(messages, {
          delayMs: delaySec * 1000,
          onProgress: (prog) => setProgressState(prog),
          signal: abortControllerRef.current.signal,
          controller: queueControllerRef.current,
        })
        setIsDispatching(false)
        setProgressState(null)
        queueControllerRef.current = null
        setDispatchSummary(result)
      } catch (err) {
        console.error('Dispatch error:', err)
        alert(err.message)
        setIsDispatching(false)
        setProgressState(null)
        queueControllerRef.current = null
      }
      return
    }
    // Manual sequential path
    setIsDispatching(true)
    queueControllerRef.current = createQueueController()
    try {
      const result = await dispatchWhatsAppLinksSequentially(messages, {
        delayMs: delaySec * 1000,
        onProgress: (prog) => setProgressState(prog),
        controller: queueControllerRef.current,
      })
      setIsDispatching(false)
      setProgressState(null)
      queueControllerRef.current = null
      setDispatchSummary(result)
    } catch (err) {
      console.error('Sequential dispatch error:', err)
      alert(err.message)
      setIsDispatching(false)
      setProgressState(null)
      queueControllerRef.current = null
    }
  }

  const copyAllLinks = async () => {
    if (!review) return
    const validUrls = review.filter((m) => m.url).map((m) => m.url)
    await navigator.clipboard.writeText(validUrls.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const openLogsModal = async () => {
    setShowLogsModal(true)
    setLoadingLogs(true)
    try {
      const logs = await fetchWhatsAppLogs({ limit: 100 })
      setLogsList(logs)
    } catch (err) {
      console.warn(err)
    } finally {
      setLoadingLogs(false)
    }
  }

  const handleRetryFailed = () => {
    if (!dispatchSummary?.errors?.length) return
    const failedStudentNames = new Set(dispatchSummary.errors.map((e) => e.studentName))
    const failedRecords = chosenRecords.filter((r) => failedStudentNames.has(r.full_name))

    // Select failed records and close summary modal
    const nextSet = new Set(failedRecords.map((r) => r.student_id))
    setSelected(nextSet)
    setDispatchSummary(null)
  }

  const statusLabel = (s) => (ATT_STATUS[lang] || ATT_STATUS.en)[s] || s || '—'

  return (
    <div className="space-y-6 font-ibm">
      {/* ---------- Controls Header Card ---------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-green-500/20 text-green-500 flex items-center justify-center">
              <MessageCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-lg">{t('bulkMessagingTitle')}</h3>
              <p className="text-xs text-slate-500">{t('bulkMessagingSubtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={openLogsModal}
              className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 text-xs font-bold flex items-center gap-1.5 transition"
            >
              <History className="w-3.5 h-3.5 text-yellow-500" />
              <span>{t('viewLogsBtn')}</span>
            </button>
          </div>
        </div>

        {/* Filters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* Grade filter */}
          <div>
            <label className="block text-xs font-bold mb-1 text-slate-500">{t('selectGrade')}</label>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold"
            >
              <option value="all">{t('allGrades')}</option>
              {YEARS.map((y) => (
                <option key={y.id} value={y.id}>
                  {lang === 'ar' ? y.titleAr : y.title}
                </option>
              ))}
            </select>
          </div>

          {/* Universal group filter (Feature 3 — shared GroupFilterSelect) */}
          <div>
            <GroupFilterSelect value={groupId} onChange={setGroupId} groups={groups} label={t('filterByGroup')} />
          </div>

          {/* Recipient Selector */}
          <div>
            <label className="block text-xs font-bold mb-1 text-slate-500">{t('recipient')}</label>
            <select
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold"
            >
              <option value="student">{t('recipientStudent')}</option>
              <option value="parent">{t('recipientParent')}</option>
            </select>
          </div>

          {/* Rate Limit Delay Selector (2 to 5 seconds) */}
          <div>
            <label className="block text-xs font-bold mb-1 text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3 text-yellow-500" />
              <span>{t('rateLimitDelay')}</span>
            </label>
            <select
              value={delaySec}
              onChange={(e) => setDelaySec(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold"
            >
              <option value={2}>2 {t('delaySeconds')}</option>
              <option value={3}>3 {t('delaySeconds')} (موصى به)</option>
              <option value={4}>4 {t('delaySeconds')}</option>
              <option value={5}>5 {t('delaySeconds')}</option>
            </select>
          </div>

          {/* Dispatch Action Buttons */}
          <div className="flex items-end gap-2">
            <button
              onClick={handleStartDispatch}
              disabled={isDispatching || !chosenRecords.length}
              className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 transition"
            >
              {isDispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>
                {t('sendBulk')} {chosenRecords.length > 0 ? `(${chosenRecords.length})` : ''}
              </span>
            </button>
            <button
              onClick={handleReviewMessages}
              disabled={isDispatching || !chosenRecords.length}
              title={t('reviewMessages')}
              className="px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-xs font-bold hover:text-yellow-500 transition disabled:opacity-50"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Rate Limiting Notice Badge */}
        <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 font-bold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-500 shrink-0" />
          <span>{t('safeDelayNotice')}</span>
        </div>
        {/* Sequential dispatch notice */}
        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300 font-bold flex items-center gap-2">
          <Send className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{t('sequentialDispatchHint')}</span>
        </div>

        {loadError && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs font-bold">
            {loadError}
          </div>
        )}
      </div>

      {/* ---------- Template Editor Card ---------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-bold text-base flex items-center gap-2">
            <FileText className="w-4 h-4 text-yellow-500" />
            <span>{t('templateEditor')}</span>
          </h3>

          {/* Variable Insertion Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400">{t('insertVariable')}:</span>
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => insertVariable(v.key)}
                className="px-2.5 py-1 rounded-lg bg-yellow-400/15 hover:bg-yellow-400/30 text-yellow-700 dark:text-yellow-300 border border-yellow-400/30 text-[11px] font-bold transition"
              >
                + {lang === 'ar' ? v.labelAr : v.labelEn}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <textarea
            ref={editorRef}
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value)
              setEdited(true)
            }}
            rows={9}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs sm:text-sm font-mono leading-relaxed resize-y"
            dir="auto"
          />

          {/* Live Preview */}
          <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-black/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-500">{t('livePreview')}</h4>
              <span className="text-[10px] text-slate-400">{t('previewHint')}</span>
            </div>
            <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-4 whitespace-pre-wrap text-xs sm:text-sm leading-relaxed max-h-48 overflow-y-auto">
              {previewValues
                ? (() => {
                    const single = buildBulkMessages(
                      [{ ...previewRecord, phone: phoneFor(previewRecord) || '201012345678' }],
                      template,
                      { lang, attendance: attendanceFormat, recipientType: recipient }
                    )
                    return single[0]?.message || '—'
                  })()
                : '—'}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <ExternalLink className="w-3.5 h-3.5 text-green-500" />
              <span dir="ltr" className="font-mono truncate">
                {previewRecord ? formatPhoneWithPlus(phoneFor(previewRecord)) : '+2010xxxxxxxx'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Student Selection Table ---------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-bold text-base flex items-center gap-2">
            <Users className="w-5 h-5 text-yellow-500" />
            <span>
              {lang === 'ar' ? `الطلاب (${visible.length})` : `Students (${visible.length})`}
              {' · '}
              {chosenRecords.length} {t('selectedOf')}
            </span>
          </h3>
          <button
            onClick={toggleAll}
            className="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 text-xs font-bold flex items-center gap-1.5"
          >
            {allVisibleSelected ? <CheckSquare className="w-4 h-4 text-yellow-500" /> : <Square className="w-4 h-4" />}
            <span>{t('selectAll')}</span>
          </button>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-12 flex items-center justify-center gap-2">
            <Filter className="w-4 h-4" /> {t('noStudentsFound')}
          </p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-xs sm:text-sm min-w-[760px]">
              <thead>
                <tr className="text-[11px] text-slate-400 text-start border-b border-slate-200 dark:border-zinc-800">
                  <th className="p-3 w-10"></th>
                  <th className="p-3 text-start font-bold">{t('student')}</th>
                  <th className="p-3 text-start font-bold">{t('groupCol')}</th>
                  <th className="p-3 text-start font-bold">{t('phoneCol')} (Normalized)</th>
                  <th className="p-3 text-start font-bold">{t('lastSession')}</th>
                  <th className="p-3 text-start font-bold">{t('attendanceCol')}</th>
                  <th className="p-3 text-start font-bold">{t('latestQuiz')}</th>
                  <th className="p-3 text-start font-bold">{t('latestHomework')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const checked = selected.has(r.student_id)
                  const rawPhone = phoneFor(r)
                  const validation = validatePhone(rawPhone)
                  const groupName = r.group_name || r.groupName || '—'

                  return (
                    <tr
                      key={r.student_id}
                      onClick={() => toggle(r.student_id)}
                      className={`border-b border-slate-100 dark:border-zinc-800/60 cursor-pointer transition ${
                        checked ? 'bg-yellow-50 dark:bg-yellow-950/20' : 'hover:bg-slate-50 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <td className="p-3">
                        {checked ? (
                          <CheckSquare className="w-4 h-4 text-yellow-500" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300 dark:text-zinc-600" />
                        )}
                      </td>
                      <td className="p-3 font-bold whitespace-nowrap">
                        {r.full_name}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                          {groupName}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-xs whitespace-nowrap" dir="ltr">
                        {validation.isValid ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            {validation.formatted}
                          </span>
                        ) : (
                          <span className="text-red-500 font-bold flex items-center gap-1" title={validation.error}>
                            <PhoneOff className="w-3 h-3" />
                            {rawPhone || t('noPhoneShort')}
                          </span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {r.last_session_attendance ? (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              PILL[r.last_session_attendance] || PILL.excused
                            }`}
                          >
                            {statusLabel(r.last_session_attendance)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold">{r.attendance_percent ?? 0}%</span>
                          <Bar value={r.attendance_percent} />
                        </div>
                      </td>
                      <td className="p-3 whitespace-nowrap font-mono text-xs">
                        {r.last_quiz_score != null && r.last_quiz_max != null ? (
                          `${r.last_quiz_score} / ${r.last_quiz_max}`
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap font-mono text-xs">
                        {r.last_homework_score != null && r.last_homework_max != null ? (
                          `${r.last_homework_score} / ${r.last_homework_max}`
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- Active Dispatch Progress Modal (sequential queue) ---------- */}
      {isDispatching && progressState && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-6 shadow-2xl border border-slate-200 dark:border-zinc-800 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center mx-auto animate-pulse">
              <Send className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold font-outfit">{t('sendingInProgress')}</h3>
              {/* Live status: "Sending message 3 of 15..." */}
              <p className="text-sm font-extrabold text-yellow-600 dark:text-yellow-400">
                {t('sendingMessageOf')} {progressState.current} {t('selectedOf')} {progressState.total}...
              </p>
              <p className="text-xs text-slate-500 font-mono">
                {progressState.studentName} ({progressState.phone})
              </p>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold text-slate-500">
                <span>{progressState.current} / {progressState.total}</span>
                <span>{progressState.percent}%</span>
              </div>
              <div className="h-3 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-300"
                  style={{ width: `${progressState.percent}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] font-bold">
                <span className="text-emerald-600 dark:text-emerald-400">
                  ✓ {progressState.successfulCount ?? 0} {t('successfulDispatches').split(' ')[0]}
                </span>
                <span className="text-red-500">
                  ✕ {progressState.failedCount ?? 0} {t('failedDispatches').split(' ')[0]}
                </span>
              </div>
            </div>

            {/* Live status chip */}
            {progressState.currentStatus === 'waiting_delay' && (
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center justify-center gap-1.5">
                <Clock className="w-4 h-4 animate-spin" />
                <span>{t('waitingNextStatus')} ({delaySec}s)</span>
              </div>
            )}
            {progressState.currentStatus === 'opening' && (
              <div className="p-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 text-xs font-bold flex items-center justify-center gap-1.5">
                <ExternalLink className="w-4 h-4 animate-pulse" />
                <span>{t('openingChatStatus')}</span>
              </div>
            )}
            {progressState.currentStatus === 'sent' && (
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>{t('bulkSentWebhook')} ✓</span>
              </div>
            )}
            {progressState.currentStatus === 'paused' && (
              <div className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-xs font-bold flex items-center justify-center gap-1.5">
                <Pause className="w-4 h-4" />
                <span>{t('pausedStatus')}</span>
              </div>
            )}

            {/* Pause / Resume / Cancel queue controls */}
            <div className="flex gap-2.5">
              {progressState.currentStatus === 'paused' ? (
                <button
                  onClick={handleResumeDispatch}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
                >
                  <Play className="w-4 h-4" />
                  <span>{t('resumeQueue')}</span>
                </button>
              ) : (
                <button
                  onClick={handlePauseDispatch}
                  className="flex-1 py-2.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                >
                  <Pause className="w-4 h-4" />
                  <span>{t('pauseQueue')}</span>
                </button>
              )}
              <button
                onClick={handleCancelDispatch}
                className="flex-1 py-2.5 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs font-bold flex items-center justify-center gap-1.5 transition"
              >
                <Ban className="w-4 h-4" />
                <span>{t('cancelQueue')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Delivery Summary Report Modal ---------- */}
      {dispatchSummary && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-6 shadow-2xl border border-slate-200 dark:border-zinc-800 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <span>{t('dispatchSummaryTitle')}</span>
              </h3>
              <button
                onClick={() => setDispatchSummary(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Counts overview */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-center">
                <span className="text-xs text-emerald-700 dark:text-emerald-300 font-bold block">{t('successfulDispatches')}</span>
                <span className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 font-outfit">
                  {dispatchSummary.successfulCount}
                </span>
              </div>
              <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-700 text-center">
                <span className="text-xs text-red-700 dark:text-red-300 font-bold block">{t('failedDispatches')}</span>
                <span className="text-3xl font-extrabold text-red-600 dark:text-red-400 font-outfit">
                  {dispatchSummary.failedCount}
                </span>
              </div>
            </div>

            {/* Errors List if any */}
            {dispatchSummary.errors.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-red-600">{lang === 'ar' ? 'تفاصيل الرسائل غير المرسلة:' : 'Failed Messages Details:'}</h4>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {dispatchSummary.errors.map((err, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 text-xs flex items-start justify-between gap-2"
                    >
                      <div>
                        <span className="font-bold text-red-800 dark:text-red-300 block">{err.studentName}</span>
                        <span className="text-[10px] text-red-600 dark:text-red-400 font-mono" dir="ltr">{err.phone}</span>
                      </div>
                      <span className="text-[11px] text-red-700 dark:text-red-300 text-end font-bold">{err.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              {dispatchSummary.failedCount > 0 && (
                <button
                  onClick={handleRetryFailed}
                  className="flex-1 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 shadow"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>{t('retryFailedBtn')}</span>
                </button>
              )}
              <button
                onClick={() => setDispatchSummary(null)}
                className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 font-bold text-xs hover:bg-slate-200"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- WhatsApp Logs History Modal ---------- */}
      {showLogsModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-3xl w-full space-y-5 max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-zinc-800">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <History className="w-5 h-5 text-yellow-500" />
                <span>{t('whatsappLogsTitle')}</span>
              </h3>
              <button
                onClick={() => setShowLogsModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingLogs ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
              </div>
            ) : logsList.length === 0 ? (
              <p className="text-center text-sm text-slate-500 py-10">{lang === 'ar' ? 'لا توجد سجلات رسائل سابقة' : 'No previous dispatch logs found'}</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {logsList.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs">{log.recipient_name || 'طالب'}</span>
                        <span className="text-[10px] text-slate-400 font-mono" dir="ltr">{log.phone}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            log.status === 'sent'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                          }`}
                        >
                          {log.status === 'sent' ? 'Sent 🟢' : 'Failed 🔴'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {log.sent_at ? new Date(log.sent_at).toLocaleString() : ''}
                        </span>
                      </div>
                    </div>

                    {log.error_message && (
                      <p className="text-[11px] text-red-500 font-bold">{log.error_message}</p>
                    )}

                    {log.message_body && (
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 line-clamp-2 bg-white dark:bg-zinc-800/60 p-2 rounded-lg">
                        {log.message_body}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- Manual wa.me Review Modal ---------- */}
      {review && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-3xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-green-500" />
                <span>{t('reviewMessages')} ({review.length})</span>
              </h3>
              <button onClick={() => setReview(null)} className="text-slate-400 hover:text-slate-600 text-xl">
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-zinc-400">{t('reviewHint')}</p>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={startSequentialFromReview}
                disabled={isDispatching}
                className="px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                <span>{t('sendSequentially')}</span>
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
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{m.studentName}</p>
                    <p className="text-[11px] text-slate-500 font-mono truncate" dir="ltr">
                      {m.phone}
                    </p>
                    <p className="text-[11px] text-slate-400 whitespace-pre-wrap line-clamp-2">{m.message}</p>
                  </div>
                  {m.url && (
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>{t('openLink')}</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
