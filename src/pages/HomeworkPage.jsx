import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import {
  ClipboardList, Loader2, Sparkles, Award, AlertCircle, Filter,
  CheckCircle2, Clock3, Send, Unlock, BookOpen, RefreshCw,
} from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import { YEARS } from '../data/dummyData'
import { fetchStudentHomeworkFeed } from '../lib/api'
import HomeworkSubmitCard from '../components/HomeworkSubmitCard.jsx'
import HomeworkExplanationVideo from '../components/HomeworkExplanationVideo.jsx'
import { HomeworkStatusBadge, VideoUnlockedBadge } from '../components/HomeworkStatusBadge.jsx'

/**
 * =====================================================================
 * HOMEWORK PAGE  —  assignments, submission, grading & gated videos
 * ---------------------------------------------------------------------
 * Completely separate from the Lessons page:
 *   1. lists the student's homework assignments,
 *   2. lets them answer and submit right here,
 *   3. marks MCQ homework automatically against the answer key
 *      (essay / file homework is graded by the teacher),
 *   4. unlocks the homework EXPLANATION VIDEO of that assignment as soon
 *      as the submission is recorded as graded.
 * =====================================================================
 */

const FILTERS = [
  { id: 'all', labelKey: 'filterAll', icon: ClipboardList },
  { id: 'pending', labelKey: 'statusPending', icon: Clock3 },
  { id: 'submitted', labelKey: 'statusSubmitted', icon: Send },
  { id: 'graded', labelKey: 'statusGraded', icon: Award },
  { id: 'unlocked', labelKey: 'statusVideoUnlocked', icon: Unlock },
]

export default function HomeworkPage() {
  const { t, lang } = useLanguage()
  const { user, profile } = useAuth()

  const [feed, setFeed] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const studentInfo = useMemo(
    () => ({
      name: profile?.full_name || user?.email || 'Physics Hub Student',
      phone: profile?.phone || '01xxxxxxxxx',
    }),
    [profile?.full_name, profile?.phone, user?.email]
  )

  const loadFeed = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    setError('')
    try {
      const rows = await fetchStudentHomeworkFeed({
        studentId: user.id,
        yearId: yearFilter === 'all' ? null : yearFilter,
        groupName: profile?.group_name || null,
      })
      setFeed(rows)
    } catch (err) {
      console.error('Failed to load homework:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.id, profile?.group_name, yearFilter])

  useEffect(() => { loadFeed() }, [loadFeed])

  // Default to the student's own grade the first time the profile loads
  useEffect(() => {
    if (profile?.year_id) setYearFilter(String(profile.year_id))
  }, [profile?.year_id])

  /** Re-read the feed after a submission; celebrate a freshly unlocked video. */
  const handleSubmitted = useCallback(async (item) => {
    const before = item.videoUnlocked
    await loadFeed()
    if (!before && item.hasVideo) {
      try {
        confetti({ particleCount: 110, spread: 75, origin: { y: 0.6 } })
      } catch (_) {}
    }
  }, [loadFeed])

  /* ----------------------------- stats ----------------------------- */
  const stats = useMemo(() => {
    const total = feed.length
    const graded = feed.filter((f) => f.status === 'graded')
    const submitted = feed.filter((f) => f.status === 'submitted' || f.status === 'returned')
    const pending = feed.filter((f) => f.status === 'pending')
    const unlocked = feed.filter((f) => f.videoUnlocked)
    const percents = graded.map((f) => Number(f.percentage)).filter((n) => Number.isFinite(n))
    return {
      total,
      graded: graded.length,
      submitted: submitted.length,
      pending: pending.length,
      unlocked: unlocked.length,
      average: percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : 0,
    }
  }, [feed])

  const visible = useMemo(() => {
    if (statusFilter === 'all') return feed
    if (statusFilter === 'unlocked') return feed.filter((f) => f.videoUnlocked)
    if (statusFilter === 'submitted') return feed.filter((f) => f.status === 'submitted' || f.status === 'returned')
    return feed.filter((f) => f.status === statusFilter)
  }, [feed, statusFilter])

  return (
    <div className="min-h-screen py-10 px-4 sm:px-8 max-w-6xl mx-auto space-y-8 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* ---------------------------- Hero ---------------------------- */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl bg-slate-900 dark:bg-zinc-900 text-white p-8 sm:p-12 shadow-2xl border border-slate-800 dark:border-yellow-400/30 space-y-4"
      >
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-yellow-400/20 border border-yellow-400/40 text-xs font-bold text-yellow-300">
          <Sparkles className="w-4 h-4 text-yellow-400" />
          <span>{t('slogan')}</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold font-outfit flex items-center gap-3">
          <ClipboardList className="w-9 h-9 text-yellow-400" />
          <span>{t('homeworkPageTitle')}</span>
        </h1>
        <p className="text-base text-slate-300 max-w-3xl">{t('homeworkPageSubtitle')}</p>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            to="/lessons"
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold flex items-center gap-1.5 transition"
          >
            <BookOpen className="w-4 h-4 text-yellow-400" />
            <span>{t('goToLessons')}</span>
          </Link>
          <button
            onClick={loadFeed}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-4 h-4 text-yellow-400 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('refresh')}</span>
          </button>
        </div>
      </motion.div>

      {/* --------------------------- Stats --------------------------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-center shadow-sm">
          <span className="block text-[11px] font-bold text-slate-500">{t('totalHomeworkLabel')}</span>
          <span className="text-2xl font-extrabold font-outfit">{stats.total}</span>
        </div>
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-center shadow-sm">
          <span className="block text-[11px] font-bold text-slate-500">{t('statusPending')}</span>
          <span className="text-2xl font-extrabold font-outfit text-slate-600 dark:text-zinc-300">{stats.pending}</span>
        </div>
        <div className="p-4 rounded-2xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-center shadow-sm">
          <span className="block text-[11px] font-bold text-slate-500">{t('statusSubmitted')}</span>
          <span className="text-2xl font-extrabold font-outfit text-sky-600 dark:text-sky-400">{stats.submitted}</span>
        </div>
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center shadow-sm">
          <span className="block text-[11px] font-bold text-slate-500">{t('statusGraded')}</span>
          <span className="text-2xl font-extrabold font-outfit text-emerald-600 dark:text-emerald-400">{stats.graded}</span>
        </div>
        <div className="p-4 rounded-2xl bg-yellow-400/10 border border-yellow-400/40 text-center shadow-sm col-span-2 sm:col-span-1">
          <span className="block text-[11px] font-bold text-slate-500">{t('averageScoreLabel')}</span>
          <span className="text-2xl font-extrabold font-outfit text-yellow-600 dark:text-yellow-400">{stats.average}%</span>
        </div>
      </div>

      {/* -------------------------- Filters -------------------------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const Icon = f.icon
            const active = statusFilter === f.id
            return (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                  active
                    ? 'bg-yellow-400 text-black shadow'
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:text-yellow-500'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t(f.labelKey)}</span>
                {f.id === 'unlocked' && stats.unlocked > 0 && (
                  <span className="px-1.5 rounded-md bg-black/10 dark:bg-white/10 font-mono">{stats.unlocked}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-200 dark:border-zinc-800 pt-3">
          <button
            onClick={() => setYearFilter('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              yearFilter === 'all'
                ? 'bg-slate-900 dark:bg-zinc-700 text-white'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
            }`}
          >
            {t('allGrades')}
          </button>
          {YEARS.map((y) => (
            <button
              key={y.id}
              onClick={() => setYearFilter(y.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                String(yearFilter) === String(y.id)
                  ? 'bg-slate-900 dark:bg-zinc-700 text-white'
                  : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
              }`}
            >
              {lang === 'ar' ? y.shortTitleAr : y.shortTitle}
            </button>
          ))}
        </div>

        <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-bold flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0" />
          <span>{t('homeworkFlowHint')}</span>
        </p>
      </div>

      {/* ------------------------ Assignments ------------------------ */}
      {loading ? (
        <div className="text-center py-20 text-yellow-500 flex flex-col items-center gap-3 font-bold">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span>{t('loading')}</span>
        </div>
      ) : error ? (
        <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm font-bold text-center">
          {error}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-3xl border border-dashed border-slate-300 dark:border-zinc-800 text-slate-500 space-y-3">
          <Filter className="w-12 h-12 mx-auto text-slate-400 dark:text-zinc-600" />
          <p className="font-bold text-lg">{t('noHomeworkYet')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {visible.map((item) => (
            <motion.div
              key={item.entry.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <HomeworkSubmitCard
                assignment={item.entry}
                submission={item.submission}
                studentId={user?.id}
                onSubmitted={() => handleSubmitted(item)}
                headerExtra={
                  <>
                    <HomeworkStatusBadge status={item.status} />
                    {item.hasVideo && <VideoUnlockedBadge unlocked={item.videoUnlocked} />}
                  </>
                }
                footer={
                  item.hasVideo ? (
                    <div className="pt-1">
                      <HomeworkExplanationVideo
                        title={item.entry.explanationVideoTitle}
                        videoUrl={item.entry.explanationVideoUrl}
                        unlocked={item.videoUnlocked}
                        status={item.status}
                        studentInfo={studentInfo}
                      />
                    </div>
                  ) : null
                }
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* --------------------------- Legend --------------------------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-3">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-yellow-500" />
          <span>{t('statusLegendTitle')}</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <HomeworkStatusBadge status="pending" />
          <HomeworkStatusBadge status="submitted" />
          <HomeworkStatusBadge status="graded" />
          <VideoUnlockedBadge unlocked />
        </div>
        <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-bold">{t('statusLegendHint')}</p>
      </div>
    </div>
  )
}
