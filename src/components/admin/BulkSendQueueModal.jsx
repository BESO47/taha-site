import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2, MessageCircle, PhoneOff, Send, SkipForward, X,
} from 'lucide-react'
import {
  buildChatUrl,
  buildNativeWhatsAppUrl,
  isMobileDevice,
  logWhatsAppDispatch,
  validatePhone,
} from '../../lib/whatsapp'

/**
 * Sequential WhatsApp send runner for mobile (and as a fallback when
 * window.open is blocked). One user-gesture per recipient.
 */
export default function BulkSendQueueModal({
  messages = [],
  lang = 'ar',
  onClose,
  onComplete,
}) {
  const [items, setItems] = useState(() =>
    messages.map((m, i) => {
      const v = validatePhone(m.phone)
      return {
        ...m,
        index: i,
        status: v.isValid ? 'pending' : 'skipped',
        error: v.isValid ? null : (v.error || 'Invalid phone'),
        normalized: v.normalized,
      }
    })
  )
  const [cursor, setCursor] = useState(() =>
    messages.findIndex((m) => validatePhone(m.phone).isValid)
  )
  const [autoAdvance, setAutoAdvance] = useState(true)
  const lastOpenedRef = useRef(-1)
  const awaitingReturnRef = useRef(false)

  const pendingCount = items.filter((i) => i.status === 'pending').length
  const sentCount = items.filter((i) => i.status === 'sent').length
  const skippedCount = items.filter((i) => i.status === 'skipped').length
  const total = items.length
  const current = cursor >= 0 && cursor < items.length ? items[cursor] : null
  const buildSummary = () => ({
    total,
    sent: sentCount,
    failed: skippedCount,
    successfulCount: sentCount,
    failedCount: skippedCount,
    errors: items.filter((i) => i.status === 'skipped').map((i) => ({
      index: i.index + 1,
      studentName: i.studentName,
      phone: i.phone,
      error: i.error || 'Skipped',
    })),
    logs: items,
  })

  const finish = (summary) => {
    onComplete?.(summary || buildSummary())
  }

  const nextPendingIndex = useCallback((from) => {
    for (let i = from; i < items.length; i++) {
      if (items[i].status === 'pending') return i
    }
    return -1
  }, [items])

  const mark = useCallback((index, status, error = null) => {
    setItems((prev) => prev.map((it) => (it.index === index ? { ...it, status, error } : it)))
  }, [])

  const openCurrent = useCallback(async () => {
    if (!current || current.status !== 'pending') return
    const v = validatePhone(current.phone)
    if (!v.isValid) {
      mark(current.index, 'skipped', v.error)
      const nxt = nextPendingIndex(current.index + 1)
      setCursor(nxt)
      return
    }

    const url = buildChatUrl(v.normalized, current.message, { mobile: isMobileDevice() })
    lastOpenedRef.current = current.index
    awaitingReturnRef.current = true

    let opened = null
    try {
      opened = window.open(url, '_blank', 'noopener,noreferrer')
    } catch (_) {
      opened = null
    }

    if (!opened) {
      const native = buildNativeWhatsAppUrl(v.normalized, current.message)
      window.location.href = native || url
    }

    mark(current.index, 'sent')
    await logWhatsAppDispatch({
      studentId: current.studentId || null,
      phone: v.normalized,
      recipientName: current.studentName || '',
      recipientType: current.target || 'student',
      messageBody: current.message,
      status: 'pending',
    })
  }, [current, mark, nextPendingIndex])

  const skipCurrent = () => {
    if (!current) return
    mark(current.index, 'skipped', lang === 'ar' ? 'تم التخطي' : 'Skipped')
    awaitingReturnRef.current = false
    const nxt = nextPendingIndex(current.index + 1)
    setCursor(nxt)
  }

  // When the user returns from WhatsApp, advance the queue.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      if (!awaitingReturnRef.current) return
      awaitingReturnRef.current = false
      if (!autoAdvance) return
      const from = lastOpenedRef.current + 1
      const nxt = nextPendingIndex(from)
      setTimeout(() => setCursor(nxt), 400)
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [autoAdvance, nextPendingIndex])

  useEffect(() => {
    if (cursor < 0 && items.length) finish()
  }, [cursor]) // eslint-disable-line react-hooks/exhaustive-deps

  const statusLabel = (s) => {
    if (lang === 'ar') {
      return { pending: 'قيد الانتظار', sent: 'تم الفتح', skipped: 'تم التخطي' }[s] || s
    }
    return { pending: 'Pending', sent: 'Opened', skipped: 'Skipped' }[s] || s
  }

  const statusClass = {
    pending: 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300',
    sent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
    skipped: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  }

  const positionLabel = useMemo(() => {
    const n = current ? current.index + 1 : total
    return lang === 'ar'
      ? `إرسال الرسالة (${n} من ${total})`
      : `Send Message (${n} of ${total})`
  }, [current, total, lang])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl p-5 sm:p-7 w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-zinc-800 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-2xl bg-green-500/15 text-green-600 flex items-center justify-center">
              <MessageCircle className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-bold text-base sm:text-lg">
                {lang === 'ar' ? 'قائمة الإرسال المتتابع' : 'Sequential send queue'}
              </h3>
              <p className="text-[11px] text-slate-500 font-bold">
                {lang === 'ar'
                  ? 'افتح واتساب لطالب واحد في كل مرة ثم ارجع للمتصفح للمتابعة.'
                  : 'Open WhatsApp for one student at a time, then return here to continue.'}
              </p>
            </div>
          </div>
          <button onClick={() => (pendingCount === 0 ? finish() : onClose())} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-slate-50 dark:bg-black/40 p-2.5">
            <p className="text-[10px] font-bold text-slate-400">{lang === 'ar' ? 'متبقي' : 'Pending'}</p>
            <p className="text-lg font-extrabold">{pendingCount}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 p-2.5">
            <p className="text-[10px] font-bold text-emerald-600">{lang === 'ar' ? 'تم' : 'Sent'}</p>
            <p className="text-lg font-extrabold text-emerald-600">{sentCount}</p>
          </div>
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 p-2.5">
            <p className="text-[10px] font-bold text-amber-700">{lang === 'ar' ? 'تخطي' : 'Skipped'}</p>
            <p className="text-lg font-extrabold text-amber-700">{skippedCount}</p>
          </div>
        </div>

        {current && current.status === 'pending' ? (
          <div className="rounded-2xl border border-green-200 dark:border-green-900 bg-green-50/70 dark:bg-green-950/20 p-4 space-y-3">
            <p className="text-xs font-bold text-slate-500">
              {current.studentName}
              <span className="font-mono ms-2" dir="ltr">{current.normalized || current.phone}</span>
            </p>
            <p className="text-[11px] text-slate-500 whitespace-pre-wrap line-clamp-4">{current.message}</p>
            <button
              type="button"
              onClick={openCurrent}
              className="w-full min-h-[52px] rounded-2xl bg-green-600 hover:bg-green-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-green-600/25"
            >
              <Send className="w-5 h-5" />
              {positionLabel}
            </button>
            <button
              type="button"
              onClick={skipCurrent}
              className="w-full py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <SkipForward className="w-4 h-4" />
              {lang === 'ar' ? 'تخطي هذا الطالب' : 'Skip this student'}
            </button>
          </div>
        ) : (
          <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 p-4 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="font-bold">
              {lang === 'ar' ? 'اكتملت قائمة الإرسال' : 'Queue finished'}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
            >
              {lang === 'ar' ? 'إغلاق' : 'Close'}
            </button>
          </div>
        )}

        <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => setAutoAdvance(e.target.checked)}
            className="accent-green-600"
          />
          {lang === 'ar'
            ? 'التقدم تلقائياً للطالب التالي عند العودة من واتساب'
            : 'Auto-advance to the next student when you return from WhatsApp'}
        </label>

        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
          {items.map((it) => (
            <li
              key={it.index}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs ${
                current?.index === it.index ? 'ring-2 ring-green-500/50' : ''
              } bg-slate-50 dark:bg-black/40`}
            >
              <div className="min-w-0">
                <p className="font-bold truncate">{it.studentName}</p>
                <p className="font-mono text-[10px] text-slate-400 truncate" dir="ltr">{it.phone}</p>
              </div>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${statusClass[it.status]}`}>
                {it.status === 'skipped' && !it.normalized ? <PhoneOff className="w-3 h-3 inline me-1" /> : null}
                {statusLabel(it.status)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
