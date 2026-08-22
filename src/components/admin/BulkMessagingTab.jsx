import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  MessageCircle, Users, Loader2, Send, Copy, Check, ExternalLink,
  Filter, CheckSquare, Square, PhoneOff, Clock, ShieldCheck,
  AlertTriangle, History, RefreshCw, X, FileText, CheckCircle2, XCircle,
  Pause, Play, Ban, QrCode, Wifi, WifiOff, LogOut, FlaskConical,
  ChevronLeft, ChevronRight, Eraser,
} from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/catalog'
import { fetchBulkMessagingReport, fetchGroups } from '../../lib/api'
import {
  dispatchWhatsAppLinksSequentially,
  dispatchBulkViaGateway,
  gatewayControls,
  resolveTransport,
  createQueueController,
  fetchWhatsAppLogs,
  validatePhone,
  normalizePhone,
  formatPhoneWithPlus,
  isMobileDevice,
} from '../../lib/whatsapp'
import {
  getGatewayStatus,
  startSession as startGatewaySession,
  stopSession as stopGatewaySession,
} from '../../lib/whatsappGateway'
import GroupFilterSelect, { getInitialGroupFilter } from './GroupFilterSelect.jsx'
import BulkSendQueueModal from './BulkSendQueueModal.jsx'
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

/** Recipient list page size — keeps thousands of rows from freezing the tab. */
const PAGE_SIZE = 50

/** Attendance rendering inside message templates ('percent' | 'ratio' | 'both'). */
const ATTENDANCE_FORMAT = 'both'

function Bar({ value, className = 'w-16' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className={`h-1.5 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden ${className}`}>
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${v}%` }} />
    </div>
  )
}

/**
 * Accessible 44×44px selection control (real interactive element with
 * role="checkbox" so touch, keyboard and screen readers all work).
 */
function SelectBox({ checked, label, onToggle }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className="w-11 h-11 -m-2 flex items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
    >
      {checked ? (
        <CheckSquare className="w-5 h-5 text-yellow-500" aria-hidden="true" />
      ) : (
        <Square className="w-5 h-5 text-slate-300 dark:text-zinc-600" aria-hidden="true" />
      )}
    </button>
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
  const [selected, setSelected] = useState(() => new Set())

  // Pagination (selection is ID-keyed, so it survives page/filter changes)
  const [page, setPage] = useState(0)

  // Inline, non-blocking feedback (replaces blocking window.alert)
  const [notice, setNotice] = useState(null) // { type: 'error'|'success'|'info', text }
  const noticeTimerRef = useRef(null)

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
  // Re-entry guard: blocks duplicate campaigns when the button is hit twice
  // before the async transport resolution flips `isDispatching` on.
  const dispatchingRef = useRef(false)

  // Summary Result Modal State
  const [dispatchSummary, setDispatchSummary] = useState(null)

  // Manual Review (wa.me) Modal State
  const [review, setReview] = useState(null)
  const [copied, setCopied] = useState(false)

  // Gateway (server-side WhatsApp session) state
  const [transport, setTransport] = useState(null) // { mode, ready, reason, status }
  const [gatewayBusy, setGatewayBusy] = useState(false)
  const [gatewayError, setGatewayError] = useState('')
  const [activeJobId, setActiveJobId] = useState(null)
  const [dryRun, setDryRun] = useState(false)
  const pollRef = useRef(null)

  // Logs History Modal State
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [logsList, setLogsList] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  // Mobile / popup-safe sequential queue
  const [mobileQueue, setMobileQueue] = useState(null)

  const notify = useCallback((text, type = 'error') => {
    setNotice({ text, type })
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setNotice(null), 7000)
  }, [])

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

  // Leaving the admin tab mid-dispatch must stop the manual window.open loop;
  // gateway campaigns intentionally keep running server-side.
  useEffect(() => {
    return () => {
      queueControllerRef.current?.cancel()
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  // Prune selections of students that no longer exist after a data reload,
  // so the Set never accumulates zombie ids with an invisible count.
  useEffect(() => {
    const ids = new Set(records.map((r) => r.student_id))
    setSelected((prev) => {
      if (!prev.size) return prev
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [records])

  useEffect(() => {
    if (!edited) {
      setTemplate(lang === 'ar' ? DEFAULT_TEMPLATE_AR : DEFAULT_TEMPLATE_EN)
    }
  }, [lang, edited])

  /* ------------------------------------------------------------------ */
  /* WhatsApp gateway: detect the transport and follow the session state */
  /* ------------------------------------------------------------------ */
  const refreshTransport = useCallback(async () => {
    try {
      const info = await resolveTransport()
      setTransport(info)
      setGatewayError('')
      return info
    } catch (err) {
      setGatewayError(err.message)
      return null
    }
  }, [])

  useEffect(() => {
    refreshTransport()
  }, [refreshTransport])

  // While a QR is pending (or the session is connecting) poll the status so
  // the code refreshes and the UI flips to "connected" automatically.
  useEffect(() => {
    const needsPolling =
      transport?.mode === 'gateway' &&
      !transport?.ready &&
      ['qr', 'starting', 'authenticated', 'disconnected'].includes(transport?.status?.status)

    if (!needsPolling) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return undefined
    }

    pollRef.current = setInterval(async () => {
      try {
        const status = await getGatewayStatus()
        setTransport((prev) => ({
          mode: 'gateway',
          ready: Boolean(status.ready),
          status,
          reason: status.ready ? `Connected via ${status.provider}` : prev?.reason || '',
        }))
      } catch (_) {}
    }, 3000)

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [transport?.mode, transport?.ready, transport?.status?.status])

  const handleConnectGateway = async () => {
    setGatewayBusy(true)
    setGatewayError('')
    try {
      const status = await startGatewaySession()
      setTransport({ mode: 'gateway', ready: Boolean(status.ready), status, reason: status.lastError || '' })
    } catch (err) {
      setGatewayError(err.message)
    } finally {
      setGatewayBusy(false)
    }
  }

  const handleDisconnectGateway = async (logout = false) => {
    setGatewayBusy(true)
    setGatewayError('')
    try {
      const status = await stopGatewaySession({ logout })
      setTransport({ mode: 'gateway', ready: false, status, reason: 'Session stopped' })
    } catch (err) {
      setGatewayError(err.message)
    } finally {
      setGatewayBusy(false)
    }
  }

  const phoneFor = useCallback((r) => (recipient === 'parent' ? r.parent_phone || r.phone : r.phone), [recipient])

  // Resolve the universal group filter (id -> name) for record filtering
  const selectedGroupName = useMemo(
    () => groups.find((g) => g.id === groupId)?.name || null,
    [groups, groupId]
  )

  // Filter records by grade and group (memoized for large datasets)
  const visible = useMemo(
    () =>
      records.filter((r) => {
        const matchYear = yearFilter === 'all' || String(r.year_id) === String(yearFilter)
        const matchGroup = !selectedGroupName || (r.group_name || r.groupName) === selectedGroupName
        return matchYear && matchGroup
      }),
    [records, yearFilter, selectedGroupName]
  )

  // Phone validation is recomputed only when the data or recipient changes,
  // not on every re-render (was previously O(n) validation per render).
  const phoneChecks = useMemo(() => {
    const map = new Map()
    for (const r of records) {
      const raw = recipient === 'parent' ? r.parent_phone || r.phone : r.phone
      map.set(r.student_id, validatePhone(raw))
    }
    return map
  }, [records, recipient])

  // Selected recipients resolve against the FULL dataset, not the current
  // filter page — selections accumulate across filters/pages and are never
  // silently dropped before sending.
  const chosenRecords = useMemo(() => records.filter((r) => selected.has(r.student_id)), [records, selected])
  const hiddenSelectedCount = chosenRecords.length - visible.filter((r) => selected.has(r.student_id)).length

  // Pagination over the filtered list
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const paged = useMemo(
    () => visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [visible, safePage]
  )
  useEffect(() => {
    setPage(0)
  }, [yearFilter, selectedGroupName])

  const toggle = useCallback(
    (id) =>
      setSelected((prev) => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      }),
    []
  )

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.student_id))

  /** "Select All Filtered" — spans every page of the active filter. */
  const toggleAll = useCallback(
    () =>
      setSelected((prev) => {
        const next = new Set(prev)
        if (allVisibleSelected) visible.forEach((r) => next.delete(r.student_id))
        else visible.forEach((r) => next.add(r.student_id))
        return next
      }),
    [allVisibleSelected, visible]
  )

  const clearSelection = useCallback(() => setSelected(new Set()), [])

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

  const previewRecord = chosenRecords[0] || visible[0]

  const previewValues = previewRecord
    ? buildVariableValues(previewRecord, { lang, attendance: ATTENDANCE_FORMAT })
    : null

  /**
   * Single recipient-resolution path used by Send, Review and the mobile
   * queue: covers single selection, multi manual selection and
   * "Select All Filtered" identically. Notifies instead of alerting.
   */
  const buildSelectedMessages = useCallback(() => {
    if (!chosenRecords.length) {
      notify(t('noSelection'), 'info')
      return null
    }
    const messages = buildBulkMessages(
      chosenRecords.map((r) => ({ ...r, phone: phoneFor(r) })),
      template,
      { lang, attendance: ATTENDANCE_FORMAT, recipientType: recipient }
    )
    if (!messages.length) {
      notify(
        lang === 'ar'
          ? 'لا يوجد أرقام هواتف مسجلة للطلاب المحددين.'
          : 'No phone numbers found for the selected recipients.'
      )
      return null
    }
    const invalidCount = messages.filter((m) => !m.isValid).length
    if (invalidCount > 0) {
      notify(
        lang === 'ar'
          ? `${invalidCount} رقم غير صالح سيتم تخطيه تلقائياً.`
          : `${invalidCount} invalid number(s) will be skipped automatically.`,
        'info'
      )
    }
    return messages
  }, [chosenRecords, template, lang, recipient, notify, phoneFor, t])

  // =========================================================================
  // BULK DISPATCH WITH DELAY / RATE LIMITING & AUDIT LOGGING
  // =========================================================================
  const handleStartDispatch = async () => {
    const messages = buildSelectedMessages()
    if (messages) await handleStartDispatchWithMessages(messages)
  }

  /** Open the review sheet (manual links) without starting the queue. */
  const handleReviewMessages = () => {
    const messages = buildSelectedMessages()
    if (messages) setReview(messages)
  }

  const handleCancelDispatch = () => {
    if (activeJobId) {
      gatewayControls.cancel(activeJobId).catch((err) => setGatewayError(err.message))
      return
    }
    if (abortControllerRef.current) abortControllerRef.current.abort()
    if (queueControllerRef.current) queueControllerRef.current.cancel()
    setIsDispatching(false)
    setProgressState(null)
    queueControllerRef.current = null
  }

  const handlePauseDispatch = () => {
    if (activeJobId) {
      gatewayControls.pause(activeJobId).catch((err) => setGatewayError(err.message))
      setProgressState((prev) => (prev ? { ...prev, currentStatus: 'paused' } : prev))
      return
    }
    queueControllerRef.current?.pause()
    setProgressState((prev) => (prev ? { ...prev, currentStatus: 'paused' } : prev))
  }

  const handleResumeDispatch = () => {
    if (activeJobId) {
      gatewayControls.resume(activeJobId).catch((err) => setGatewayError(err.message))
      setProgressState((prev) => (prev ? { ...prev, currentStatus: 'resuming' } : prev))
      return
    }
    queueControllerRef.current?.resume()
    setProgressState((prev) => (prev ? { ...prev, currentStatus: 'resuming' } : prev))
  }

  /** Start the sequential dispatch from the review sheet. */
  const startSequentialFromReview = async () => {
    if (!review || !review.length) return
    const messages = review
    setReview(null)
    setDispatchSummary(null)
    await handleStartDispatchWithMessages(messages)
  }

  /** Shared dispatcher used by the main button, the review sheet and mobile. */
  const handleStartDispatchWithMessages = async (messages) => {
    if (!messages.length) {
      notify(t('noSelection'), 'info')
      return
    }
    // Re-entry guard: a second trigger while a campaign is resolving or
    // running must never create a duplicate job (double-send risk).
    if (dispatchingRef.current) return
    dispatchingRef.current = true

    try {
      const info = transport?.mode ? transport : await refreshTransport()

      // ---------------- 1) Mobile + no gateway -> one-gesture queue --------
      // window.open() popups are gesture-bound: on a phone only the first
      // chat would open and the rest would report "popup blocked". Hand the
      // campaign to the tap-through queue modal instead.
      if (info?.mode !== 'gateway' && isMobileDevice()) {
        setMobileQueue(messages)
        return
      }

      // ---------------- 2) Gateway (fully automatic) ----------------
      if (info?.mode === 'gateway') {
        if (!info.ready) {
          setGatewayError(info.reason || 'The WhatsApp session is not connected yet.')
          return
        }
        setIsDispatching(true)
        setGatewayError('')
        try {
          const result = await dispatchBulkViaGateway(messages, {
            delayMs: delaySec * 1000,
            jitterMs: 2000,
            dryRun,
            onJob: (job) => setActiveJobId(job.id),
            onProgress: (prog) => setProgressState(prog),
          })
          setDispatchSummary(result)
        } catch (err) {
          console.error('Gateway dispatch error:', err)
          setGatewayError(err.message)
        } finally {
          setIsDispatching(false)
          setProgressState(null)
          setActiveJobId(null)
        }
        return
      }

      // ---------------- 3) Desktop manual sequential path ----------------
      setIsDispatching(true)
      queueControllerRef.current = createQueueController()
      try {
        const result = await dispatchWhatsAppLinksSequentially(messages, {
          delayMs: delaySec * 1000,
          onProgress: (prog) => setProgressState(prog),
          controller: queueControllerRef.current,
        })
        setDispatchSummary(result)
      } catch (err) {
        console.error('Sequential dispatch error:', err)
        notify(err.message)
      } finally {
        setIsDispatching(false)
        setProgressState(null)
        queueControllerRef.current = null
      }
    } finally {
      dispatchingRef.current = false
    }
  }

  const copyAllLinks = async () => {
    if (!review) return
    const validUrls = review.filter((m) => m.url).map((m) => m.url)
    try {
      await navigator.clipboard.writeText(validUrls.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {
      notify(lang === 'ar' ? 'تعذر النسخ إلى الحافظة.' : 'Could not copy to the clipboard.')
    }
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

  /**
   * Re-select the recipients of a failed campaign. Matching uses the
   * student id (with phone fallback) — matching by display name collides
   * whenever two students share a name.
   */
  const handleRetryFailed = () => {
    const errors = dispatchSummary?.errors || []
    if (!errors.length) return
    const wantedIds = new Set(errors.map((e) => e.studentId).filter(Boolean))
    const wantedPhones = new Set(errors.map((e) => normalizePhone(e.phone || '')).filter(Boolean))

    let failedRecords = records.filter(
      (r) =>
        wantedIds.has(r.student_id) ||
        wantedPhones.has(normalizePhone(phoneFor(r)))
    )
    // Fallback when rows changed since the campaign: trust ids alone.
    if (!failedRecords.length && wantedIds.size) {
      failedRecords = records.filter((r) => wantedIds.has(r.student_id))
    }
    setSelected(new Set(failedRecords.map((r) => r.student_id)))
    setDispatchSummary(null)
    notify(
      lang === 'ar'
        ? `تم تحديد ${failedRecords.length} مستلم فشل الإرسال إليهم — أعد المحاولة.`
        : `${failedRecords.length} failed recipient(s) selected — try again.`,
      'info'
    )
  }

  const statusLabel = (s) => (ATT_STATUS[lang] || ATT_STATUS.en)[s] || s || '—'

  const statCells = (r) => (
    <>
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
    </>
  )

  return (
    <div className="space-y-6 font-ibm">
      {/* ---------- Controls Header Card ---------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-4 sm:p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-5">
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
              className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 text-xs font-bold flex items-center gap-1.5 transition"
            >
              <History className="w-4 h-4 text-yellow-500" />
              <span>{t('viewLogsBtn')}</span>
            </button>
          </div>
        </div>

        {/* ---------- WhatsApp connection (gateway) ---------- */}
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-black/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              {transport?.ready ? (
                <span className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
                  <Wifi className="w-5 h-5" />
                </span>
              ) : (
                <span className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
                  <WifiOff className="w-5 h-5" />
                </span>
              )}
              <div>
                <p className="text-sm font-extrabold">
                  {transport?.mode === 'gateway'
                    ? (lang === 'ar' ? 'بوابة واتساب (إرسال آلي)' : 'WhatsApp gateway (automatic sending)')
                    : (lang === 'ar' ? 'الوضع اليدوي عبر واتساب ويب' : 'Manual WhatsApp Web mode')}
                </p>
                <p className="text-[11px] text-slate-500 font-bold">
                  {transport?.status?.provider ? `${transport.status.provider} · ` : ''}
                  {transport?.status?.status || transport?.mode || '—'}
                  {transport?.status?.me?.pushname ? ` · ${transport.status.me.pushname}` : ''}
                  {transport?.reason ? ` — ${transport.reason}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={refreshTransport}
                disabled={gatewayBusy}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-yellow-500 ${gatewayBusy ? 'animate-spin' : ''}`} />
                <span>{lang === 'ar' ? 'تحديث الحالة' : 'Refresh'}</span>
              </button>

              {transport?.mode === 'gateway' && !transport?.ready && (
                <button
                  onClick={handleConnectGateway}
                  disabled={gatewayBusy}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-extrabold flex items-center gap-1.5"
                >
                  {gatewayBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                  <span>{lang === 'ar' ? 'ربط واتساب' : 'Connect WhatsApp'}</span>
                </button>
              )}

              {transport?.mode === 'gateway' && transport?.ready && (
                <button
                  onClick={() => handleDisconnectGateway(true)}
                  disabled={gatewayBusy}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-900 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? 'فصل الجلسة' : 'Log out'}</span>
                </button>
              )}

              <label className="min-h-[44px] px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-yellow-400 w-4 h-4" />
                <FlaskConical className="w-3.5 h-3.5 text-yellow-500" />
                <span>{lang === 'ar' ? 'تجربة بدون إرسال' : 'Dry run'}</span>
              </label>
            </div>
          </div>

          {/* QR code to link the WhatsApp account */}
          {transport?.status?.qr && !transport?.ready && (
            <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
              <img src={transport.status.qr} alt="WhatsApp QR" className="w-40 h-40 rounded-xl border border-slate-200 dark:border-zinc-700" />
              <ol className="text-[11px] font-bold text-slate-600 dark:text-zinc-300 space-y-1 list-decimal ltr:pl-4 rtl:pr-4">
                <li>{lang === 'ar' ? 'افتح واتساب على هاتف المدرس' : 'Open WhatsApp on the teacher phone'}</li>
                <li>{lang === 'ar' ? 'الإعدادات ← الأجهزة المرتبطة ← ربط جهاز' : 'Settings → Linked devices → Link a device'}</li>
                <li>{lang === 'ar' ? 'امسح رمز QR الظاهر هنا' : 'Scan the QR code shown here'}</li>
                <li>{lang === 'ar' ? 'ستتحول الحالة إلى «جاهز» تلقائياً' : 'The status flips to “ready” automatically'}</li>
              </ol>
            </div>
          )}

          {transport?.mode === 'manual' && (
            <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
              <span>
                {lang === 'ar'
                  ? 'لم يتم العثور على بوابة واتساب. على الهاتف ستُفتح المحادثات واحترافياً واحدة تلو الأخرى بضغطة لكل طالب؛ على الكمبيوتر تُفتح النوافذ تباعاً (قد يحجب المتصفح النوافذ المنبثقة). شغّل الخادم في مجلد server لتفعيل الإرسال الآلي.'
                  : 'No WhatsApp gateway detected. On phones, chats open one at a time with a tap per student; on desktop, windows open sequentially (popups may be blocked). Start the service in `server/` for fully automatic sending.'}
              </span>
            </p>
          )}

          {gatewayError && (
            <p className="text-[11px] font-bold text-red-600 dark:text-red-400 flex items-start gap-2" role="alert">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{gatewayError}</span>
            </p>
          )}
        </div>

        {/* Filters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* Grade filter */}
          <div>
            <label htmlFor="bm-year-filter" className="block text-xs font-bold mb-1 text-slate-500">{t('selectGrade')}</label>
            <select
              id="bm-year-filter"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="w-full px-3.5 py-2.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold"
            >
              <option value="all">{t('allGrades')}</option>
              {YEARS.map((y) => (
                <option key={y.id} value={y.id}>
                  {lang === 'ar' ? y.titleAr : y.title}
                </option>
              ))}
            </select>
          </div>

          {/* Universal group filter */}
          <div>
            <GroupFilterSelect value={groupId} onChange={setGroupId} groups={groups} label={t('filterByGroup')} />
          </div>

          {/* Recipient Selector */}
          <div>
            <label htmlFor="bm-recipient" className="block text-xs font-bold mb-1 text-slate-500">{t('recipient')}</label>
            <select
              id="bm-recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full px-3.5 py-2.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold"
            >
              <option value="student">{t('recipientStudent')}</option>
              <option value="parent">{t('recipientParent')}</option>
            </select>
          </div>

          {/* Rate Limit Delay Selector (2 to 5 seconds) */}
          <div>
            <label htmlFor="bm-delay" className="block text-xs font-bold mb-1 text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3 text-yellow-500" />
              <span>{t('rateLimitDelay')}</span>
            </label>
            <select
              id="bm-delay"
              value={delaySec}
              onChange={(e) => setDelaySec(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold"
            >
              <option value={2}>2 {t('delaySeconds')}</option>
              <option value={3}>
                3 {t('delaySeconds')}{lang === 'ar' ? ' (موصى به)' : ' (recommended)'}
              </option>
              <option value={4}>4 {t('delaySeconds')}</option>
              <option value={5}>5 {t('delaySeconds')}</option>
            </select>
          </div>

          {/* Dispatch Action Buttons */}
          <div className="flex items-end gap-2">
            <button
              onClick={handleStartDispatch}
              disabled={isDispatching || !chosenRecords.length}
              className="flex-1 min-h-[48px] py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 transition active:scale-[0.99]"
            >
              {isDispatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span className="truncate">
                {t('sendBulk')} {chosenRecords.length > 0 ? `(${chosenRecords.length})` : ''}
              </span>
            </button>
            <button
              onClick={handleReviewMessages}
              disabled={isDispatching || !chosenRecords.length}
              title={t('reviewMessages')}
              aria-label={t('reviewMessages')}
              className="min-w-[48px] min-h-[48px] px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-xs font-bold hover:text-yellow-500 transition disabled:opacity-50 flex items-center justify-center"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Non-blocking inline feedback (replaces window.alert) */}
        {notice && (
          <div
            role={notice.type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`p-3 rounded-2xl border text-[11px] font-bold flex items-center gap-2 ${
              notice.type === 'error'
                ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                : notice.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                  : 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300'
            }`}
          >
            {notice.type === 'error' ? (
              <XCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span>{notice.text}</span>
            <button
              onClick={() => setNotice(null)}
              className="ms-auto p-1 rounded-md opacity-70 hover:opacity-100"
              aria-label={lang === 'ar' ? 'إغلاق التنبيه' : 'Dismiss notification'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

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
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs font-bold" role="alert">
            {loadError}
          </div>
        )}
      </div>

      {/* ---------- Template Editor Card ---------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-4 sm:p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-bold text-base flex items-center gap-2">
            <FileText className="w-4 h-4 text-yellow-500" />
            <span>{t('templateEditor')}</span>
          </h3>

          {/* Variable Insertion Pills (touch-friendly) */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400">{t('insertVariable')}:</span>
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => insertVariable(v.key)}
                className="px-2.5 min-h-[36px] py-1.5 rounded-lg bg-yellow-400/15 hover:bg-yellow-400/30 text-yellow-700 dark:text-yellow-300 border border-yellow-400/30 text-[11px] font-bold transition"
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
            aria-label={t('templateEditor')}
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
                      { lang, attendance: ATTENDANCE_FORMAT, recipientType: recipient }
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

      {/* ---------- Student Selection ---------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-4 sm:p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-bold text-base flex items-center gap-2">
            <Users className="w-5 h-5 text-yellow-500" />
            <span>
              {lang === 'ar' ? `الطلاب (${visible.length})` : `Students (${visible.length})`}
              {' · '}
              {chosenRecords.length} {t('selectedOf')}
              {hiddenSelectedCount > 0 && (
                <span className="text-yellow-600 dark:text-yellow-400 text-[11px]">
                  {lang === 'ar'
                    ? ` (+${hiddenSelectedCount} خارج الفلتر الحالي)`
                    : ` (+${hiddenSelectedCount} outside current filter)`}
                </span>
              )}
            </span>
          </h3>
          <div className="flex items-center gap-2">
            {chosenRecords.length > 0 && (
              <button
                onClick={clearSelection}
                className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 text-xs font-bold flex items-center gap-1.5"
              >
                <Eraser className="w-4 h-4" />
                <span>{lang === 'ar' ? 'مسح التحديد' : 'Clear'}</span>
              </button>
            )}
            <button
              onClick={toggleAll}
              aria-pressed={allVisibleSelected}
              aria-label={t('selectAll')}
              className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 text-xs font-bold flex items-center gap-1.5"
            >
              {allVisibleSelected ? <CheckSquare className="w-4 h-4 text-yellow-500" /> : <Square className="w-4 h-4" />}
              <span>{t('selectAll')}</span>
            </button>
          </div>
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
          <>
            {/* ----- Mobile: stacked cards (no horizontal scrolling) ----- */}
            <ul className="lg:hidden space-y-2.5">
              {paged.map((r) => {
                const checked = selected.has(r.student_id)
                const rawPhone = phoneFor(r)
                const validation = phoneChecks.get(r.student_id) || validatePhone(rawPhone)
                const groupName = r.group_name || r.groupName || '—'
                return (
                  <li
                    key={r.student_id}
                    onClick={() => toggle(r.student_id)}
                    className={`rounded-2xl border p-3.5 cursor-pointer transition ${
                      checked
                        ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-300 dark:border-yellow-800'
                        : 'bg-slate-50 dark:bg-black/40 border-slate-100 dark:border-zinc-800 active:bg-slate-100 dark:active:bg-zinc-800/60'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <SelectBox
                        checked={checked}
                        label={`${checked ? (lang === 'ar' ? 'إلغاء تحديد' : 'Deselect') : (lang === 'ar' ? 'تحديد' : 'Select')} ${r.full_name}`}
                        onToggle={() => toggle(r.student_id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bold text-sm truncate">{r.full_name}</p>
                          <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200/70 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                            {groupName}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[11px]" dir="ltr">
                          {validation.isValid ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold inline-flex items-center gap-1">
                              <Check className="w-3 h-3" aria-hidden="true" />
                              {validation.formatted}
                            </span>
                          ) : (
                            <span className="text-red-500 font-bold inline-flex items-center gap-1" title={validation.error}>
                              <PhoneOff className="w-3 h-3" aria-hidden="true" />
                              {rawPhone || t('noPhoneShort')}
                            </span>
                          )}
                        </p>
                        <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px] text-slate-500 dark:text-zinc-400">
                          {r.last_session_attendance && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PILL[r.last_session_attendance] || PILL.excused}`}>
                              {statusLabel(r.last_session_attendance)}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1.5 font-bold">
                            {r.attendance_percent ?? 0}%
                            <Bar value={r.attendance_percent} className="w-12" />
                          </span>
                          <span className="font-mono">
                            {r.last_quiz_score != null && r.last_quiz_max != null ? `${r.last_quiz_score}/${r.last_quiz_max}` : ''}
                          </span>
                          <span className="font-mono">
                            {r.last_homework_score != null && r.last_homework_max != null ? `HW ${r.last_homework_score}/${r.last_homework_max}` : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>

            {/* ----- Desktop: full table ----- */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-slate-400 text-start border-b border-slate-200 dark:border-zinc-800">
                    <th className="p-3 w-12" scope="col"><span className="sr-only">{t('selectAll')}</span></th>
                    <th className="p-3 text-start font-bold" scope="col">{t('student')}</th>
                    <th className="p-3 text-start font-bold" scope="col">{t('groupCol')}</th>
                    <th className="p-3 text-start font-bold" scope="col">
                      {t('phoneCol')}
                      <span className="block text-[9px] font-normal text-slate-400">
                        {lang === 'ar' ? 'مُوحَّد دولياً' : 'Normalized'}
                      </span>
                    </th>
                    <th className="p-3 text-start font-bold" scope="col">{t('lastSession')}</th>
                    <th className="p-3 text-start font-bold" scope="col">{t('attendanceCol')}</th>
                    <th className="p-3 text-start font-bold" scope="col">{t('latestQuiz')}</th>
                    <th className="p-3 text-start font-bold" scope="col">{t('latestHomework')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => {
                    const checked = selected.has(r.student_id)
                    const rawPhone = phoneFor(r)
                    const validation = phoneChecks.get(r.student_id) || validatePhone(rawPhone)
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
                          <SelectBox
                            checked={checked}
                            label={`${checked ? (lang === 'ar' ? 'إلغاء تحديد' : 'Deselect') : (lang === 'ar' ? 'تحديد' : 'Select')} ${r.full_name}`}
                            onToggle={() => toggle(r.student_id)}
                          />
                        </td>
                        <td className="p-3 font-bold whitespace-nowrap">{r.full_name}</td>
                        <td className="p-3 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                            {groupName}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-xs whitespace-nowrap" dir="ltr">
                          {validation.isValid ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                              <Check className="w-3 h-3" aria-hidden="true" />
                              {validation.formatted}
                            </span>
                          ) : (
                            <span className="text-red-500 font-bold flex items-center gap-1" title={validation.error}>
                              <PhoneOff className="w-3 h-3" aria-hidden="true" />
                              {rawPhone || t('noPhoneShort')}
                            </span>
                          )}
                        </td>
                        {statCells(r)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ----- Pagination (selection persists across pages) ----- */}
            {totalPages > 1 && (
              <nav
                className="flex items-center justify-between gap-3 pt-1"
                aria-label={lang === 'ar' ? 'التنقل بين الصفحات' : 'Pagination'}
              >
                <p className="text-[11px] font-bold text-slate-500">
                  {lang === 'ar'
                    ? `عرض ${safePage * PAGE_SIZE + 1}–${Math.min(visible.length, (safePage + 1) * PAGE_SIZE)} من ${visible.length}`
                    : `Showing ${safePage * PAGE_SIZE + 1}–${Math.min(visible.length, (safePage + 1) * PAGE_SIZE)} of ${visible.length}`}
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    aria-label={lang === 'ar' ? 'الصفحة السابقة' : 'Previous page'}
                    className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-100 dark:bg-zinc-800 disabled:opacity-40 flex items-center justify-center"
                  >
                    {lang === 'ar' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                  </button>
                  <span className="text-xs font-extrabold px-2" aria-current="page">
                    {safePage + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage >= totalPages - 1}
                    aria-label={lang === 'ar' ? 'الصفحة التالية' : 'Next page'}
                    className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-100 dark:bg-zinc-800 disabled:opacity-40 flex items-center justify-center"
                  >
                    {lang === 'ar' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>

      {/* ---------- Active Dispatch Progress Modal (sequential queue) ---------- */}
      {isDispatching && progressState && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('sendingInProgress')}>
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-6 shadow-2xl border border-slate-200 dark:border-zinc-800 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center mx-auto animate-pulse">
              <Send className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold font-outfit">{t('sendingInProgress')}</h3>
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
              <div
                className="h-3 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden"
                role="progressbar"
                aria-valuenow={progressState.percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-300"
                  style={{ width: `${progressState.percent}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] font-bold">
                <span className="text-emerald-600 dark:text-emerald-400">
                  ✓ {progressState.successfulCount ?? 0} {lang === 'ar' ? 'ناجح' : 'sent'}
                </span>
                <span className="text-red-500">
                  ✕ {progressState.failedCount ?? 0} {lang === 'ar' ? 'فاشل' : 'failed'}
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
            {(progressState.currentStatus === 'batch_pause' || progressState.currentStatus === 'resuming') && (
              <div className="p-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 text-xs font-bold flex items-center justify-center gap-1.5">
                <Clock className="w-4 h-4 animate-spin" />
                <span>
                  {progressState.currentStatus === 'batch_pause'
                    ? (lang === 'ar' ? 'استراحة تبريد بين الدفعات…' : 'Cooling down between batches…')
                    : (lang === 'ar' ? 'جارٍ الاستئناف…' : 'Resuming…')}
                </span>
              </div>
            )}

            {/* Pause / Resume / Cancel queue controls */}
            <div className="flex gap-2.5">
              {progressState.currentStatus === 'paused' ? (
                <button
                  onClick={handleResumeDispatch}
                  className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
                >
                  <Play className="w-4 h-4" />
                  <span>{t('resumeQueue')}</span>
                </button>
              ) : (
                <button
                  onClick={handlePauseDispatch}
                  className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                >
                  <Pause className="w-4 h-4" />
                  <span>{t('pauseQueue')}</span>
                </button>
              )}
              <button
                onClick={handleCancelDispatch}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs font-bold flex items-center justify-center gap-1.5 transition"
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('dispatchSummaryTitle')}>
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-6 shadow-2xl border border-slate-200 dark:border-zinc-800 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <span>{t('dispatchSummaryTitle')}</span>
              </h3>
              <button
                onClick={() => setDispatchSummary(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600"
                aria-label={t('cancel')}
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
            {dispatchSummary.errors?.length > 0 && (
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
                  className="flex-1 min-h-[48px] py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 shadow"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>{t('retryFailedBtn')}</span>
                </button>
              )}
              <button
                onClick={() => setDispatchSummary(null)}
                className="flex-1 min-h-[48px] py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 font-bold text-xs hover:bg-slate-200"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- WhatsApp Logs History Modal ---------- */}
      {showLogsModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('whatsappLogsTitle')}>
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-3xl w-full space-y-5 max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-zinc-800">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <History className="w-5 h-5 text-yellow-500" />
                <span>{t('whatsappLogsTitle')}</span>
              </h3>
              <button
                onClick={() => setShowLogsModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600"
                aria-label={t('cancel')}
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
                        <span className="font-bold text-xs">{log.recipient_name || (lang === 'ar' ? 'طالب' : 'Student')}</span>
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
                          {log.status === 'sent'
                            ? (lang === 'ar' ? 'تم الإرسال 🟢' : 'Sent 🟢')
                            : (lang === 'ar' ? 'فشل 🔴' : 'Failed 🔴')}
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

      {/* ---------- Mobile one-gesture-per-send queue ---------- */}
      {mobileQueue && (
        <BulkSendQueueModal
          messages={mobileQueue}
          lang={lang}
          onClose={() => setMobileQueue(null)}
          onComplete={(summary) => {
            setDispatchSummary(summary)
            setMobileQueue(null)
          }}
        />
      )}

      {/* ---------- Manual wa.me Review Modal ---------- */}
      {review && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('reviewMessages')}>
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-3xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-green-500" />
                <span>{t('reviewMessages')} ({review.length})</span>
              </h3>
              <button
                onClick={() => setReview(null)}
                className="p-2 text-slate-400 hover:text-slate-600"
                aria-label={t('cancel')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-zinc-400">{t('reviewHint')}</p>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={startSequentialFromReview}
                disabled={isDispatching}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                <span>{t('sendSequentially')}</span>
              </button>
              <button
                onClick={copyAllLinks}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-xs font-bold flex items-center gap-2"
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
                      className="shrink-0 min-h-[44px] px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold flex items-center gap-1.5"
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
