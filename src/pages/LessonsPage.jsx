import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  BookOpen, Play, Search, Loader2, Sparkles, FileDown, Clock, Eye,
  CheckCircle2, Circle, GraduationCap, Layers, TrendingUp, Video, X,
} from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import { YEARS } from '../data/dummyData'
import { fetchLessonsFromSupabase } from '../lib/supabase'
import { fetchVideos } from '../lib/api'
import ProtectedVideoPlayer from '../components/ProtectedVideoPlayer.jsx'
import {
  getLessonProgress, summarizeProgress, summarizeByUnit, toggleLessonCompleted,
} from '../lib/progress'

/**
 * =====================================================================
 * LESSONS PAGE  —  content delivery only
 * ---------------------------------------------------------------------
 * Instructional video lessons, summaries and course-module progress.
 * By design this page NEVER shows or links to homework assignments:
 * everything related to homework lives on /homework.
 * =====================================================================
 */
export default function LessonsPage() {
  const { t, lang } = useLanguage()
  const { user, profile } = useAuth()

  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(true)
  const [yearFilter, setYearFilter] = useState('all')
  const [unitFilter, setUnitFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [progressTick, setProgressTick] = useState(0)

  // Extra resources: standalone videos published from the admin dashboard
  const [libraryVideos, setLibraryVideos] = useState([])
  const [activeVideo, setActiveVideo] = useState(null)

  const studentId = user?.id || null

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchLessonsFromSupabase()
      .then((data) => { if (alive) setLessons(Array.isArray(data) ? data : []) })
      .catch((err) => console.error('Failed to load lessons:', err))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    fetchVideos({ yearId: yearFilter, publishedOnly: true })
      .then((rows) => { if (alive) setLibraryVideos(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (alive) setLibraryVideos([]) })
    return () => { alive = false }
  }, [yearFilter])

  // Default to the student's own grade
  useEffect(() => {
    if (profile?.year_id) setYearFilter(String(profile.year_id))
  }, [profile?.year_id])

  // Keep the progress bars in sync when a lesson is completed elsewhere
  useEffect(() => {
    const onChange = () => setProgressTick((v) => v + 1)
    window.addEventListener('lesson-progress-changed', onChange)
    return () => window.removeEventListener('lesson-progress-changed', onChange)
  }, [])

  const byYear = useMemo(
    () => lessons.filter((l) => yearFilter === 'all' || String(l.yearId) === String(yearFilter)),
    [lessons, yearFilter]
  )

  const units = useMemo(() => {
    const set = new Set()
    byYear.forEach((l) => { if (l.unit) set.add(l.unit) })
    return [...set]
  }, [byYear])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return byYear.filter((l) => {
      const matchUnit = unitFilter === 'all' || l.unit === unitFilter
      const matchQuery =
        !q ||
        String(l.title || '').toLowerCase().includes(q) ||
        String(l.branch || '').toLowerCase().includes(q) ||
        String(l.unit || '').toLowerCase().includes(q)
      return matchUnit && matchQuery
    })
  }, [byYear, unitFilter, query])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const progress = useMemo(() => summarizeProgress(studentId, byYear), [studentId, byYear, progressTick])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const unitProgress = useMemo(() => summarizeByUnit(studentId, byYear), [studentId, byYear, progressTick])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const progressMap = useMemo(() => getLessonProgress(studentId), [studentId, progressTick])

  const handleToggleComplete = useCallback((lessonId) => {
    toggleLessonCompleted(studentId, lessonId)
    setProgressTick((v) => v + 1)
  }, [studentId])

  return (
    <div className="min-h-screen py-10 px-4 sm:px-8 max-w-7xl mx-auto space-y-8 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
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
          <BookOpen className="w-9 h-9 text-yellow-400" />
          <span>{t('lessonsPageTitle')}</span>
        </h1>
        <p className="text-base text-slate-300 max-w-3xl">{t('lessonsPageSubtitle')}</p>
      </motion.div>

      {/* ------------------- Course progress overview ------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-yellow-500" />
              <span>{t('courseProgressTitle')}</span>
            </h2>
            <span className="text-xs font-bold text-slate-500">
              {progress.completed} / {progress.total} {t('lessonsCompletedLabel')}
            </span>
          </div>

          <div className="h-3 w-full rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-emerald-500"
              initial={{ width: 0 }}
              animate={{ width: `${progress.percent}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-zinc-800">
              <span className="block text-[11px] font-bold text-slate-500">{t('totalLessonsLabel')}</span>
              <span className="text-xl font-extrabold font-outfit">{progress.total}</span>
            </div>
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
              <span className="block text-[11px] font-bold text-slate-500">{t('completedLabel')}</span>
              <span className="text-xl font-extrabold font-outfit text-emerald-600 dark:text-emerald-400">{progress.completed}</span>
            </div>
            <div className="p-3 rounded-2xl bg-yellow-400/10 border border-yellow-400/40">
              <span className="block text-[11px] font-bold text-slate-500">{t('progressLabel')}</span>
              <span className="text-xl font-extrabold font-outfit text-yellow-600 dark:text-yellow-400">{progress.percent}%</span>
            </div>
          </div>
        </div>

        {/* Per-module progress */}
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-3">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Layers className="w-5 h-5 text-yellow-500" />
            <span>{t('modulesProgressTitle')}</span>
          </h2>
          <div className="space-y-2.5 max-h-56 overflow-y-auto pe-1">
            {unitProgress.length === 0 ? (
              <p className="text-xs text-slate-400 font-bold py-4 text-center">— {t('noLessonsYet')} —</p>
            ) : (
              unitProgress.map((u) => (
                <div key={u.unit} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                    <span className="truncate">{u.unit}</span>
                    <span className="text-slate-400 shrink-0 font-mono">{u.completed}/{u.total}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${u.percent}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* --------------------------- Filters --------------------------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setYearFilter('all'); setUnitFilter('all') }}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition ${
              yearFilter === 'all'
                ? 'bg-yellow-400 text-black shadow'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:text-yellow-500'
            }`}
          >
            {t('allGrades')}
          </button>
          {YEARS.map((y) => (
            <button
              key={y.id}
              onClick={() => { setYearFilter(y.id); setUnitFilter('all') }}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm transition ${
                String(yearFilter) === String(y.id)
                  ? 'bg-yellow-400 text-black shadow'
                  : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:text-yellow-500'
              }`}
            >
              {lang === 'ar' ? y.shortTitleAr : y.shortTitle}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 ltr:left-3.5 rtl:right-3.5 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchLessonsPlaceholder')}
              className="w-full ltr:pl-10 rtl:pr-10 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          </div>

          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            className="sm:w-72 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-bold"
          >
            <option value="all">{t('allModules')}</option>
            {units.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      {/* --------------------------- Lessons --------------------------- */}
      {loading ? (
        <div className="text-center py-20 text-yellow-500 flex flex-col items-center gap-3 font-bold">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span>{t('loading')}</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-3xl border border-dashed border-slate-300 dark:border-zinc-800 text-slate-500 space-y-3">
          <BookOpen className="w-12 h-12 mx-auto text-slate-400 dark:text-zinc-600" />
          <p className="font-bold text-lg">{t('noLessonsYet')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {visible.map((lesson, index) => {
            const state = progressMap[String(lesson.id)]
            const completed = Boolean(state?.completed)
            const watched = Boolean(state?.watchedAt)

            return (
              <motion.div
                key={lesson.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.3) }}
                className={`bg-white dark:bg-zinc-900 rounded-3xl border shadow-sm overflow-hidden flex flex-col transition hover:shadow-lg ${
                  completed
                    ? 'border-emerald-300 dark:border-emerald-800'
                    : 'border-slate-200 dark:border-zinc-800 hover:border-yellow-400/50'
                }`}
              >
                {/* Thumbnail / play strip */}
                <Link
                  to={`/lessons/${lesson.id}`}
                  className="relative h-32 bg-gradient-to-br from-slate-900 to-zinc-800 flex items-center justify-center group"
                >
                  <div className="w-14 h-14 rounded-full bg-yellow-400 text-black flex items-center justify-center shadow-xl group-hover:scale-110 transition">
                    <Play className="w-7 h-7 fill-black" />
                  </div>
                  <span className="absolute top-3 ltr:right-3 rtl:left-3 px-2.5 py-1 rounded-lg bg-black/60 text-white text-[10px] font-bold flex items-center gap-1">
                    <Clock className="w-3 h-3 text-yellow-400" />
                    {lesson.duration}
                  </span>
                  {completed && (
                    <span className="absolute top-3 ltr:left-3 rtl:right-3 px-2.5 py-1 rounded-lg bg-emerald-500 text-white text-[10px] font-extrabold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {t('completedLabel')}
                    </span>
                  )}
                  {!completed && watched && (
                    <span className="absolute top-3 ltr:left-3 rtl:right-3 px-2.5 py-1 rounded-lg bg-sky-500 text-white text-[10px] font-extrabold flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      {t('inProgressLabel')}
                    </span>
                  )}
                </Link>

                <div className="p-5 space-y-3 flex-1 flex flex-col">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-400/15 text-yellow-700 dark:text-yellow-300 border border-yellow-400/30">
                        {lesson.branch}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 truncate">{lesson.unit}</span>
                    </div>

                    <Link
                      to={`/lessons/${lesson.id}`}
                      className="block font-bold text-base leading-snug hover:text-yellow-500 transition"
                    >
                      {lesson.title}
                    </Link>

                    {lesson.description && (
                      <p className="text-xs text-slate-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                        {lesson.description}
                      </p>
                    )}
                  </div>

                  {/* Materials & resources */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {lesson.summaryPdfUrl && (
                      <a
                        href={lesson.summaryPdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:text-yellow-500 inline-flex items-center gap-1.5 transition"
                      >
                        <FileDown className="w-3.5 h-3.5 text-yellow-500" />
                        {t('lessonSummaryPdf')}
                      </a>
                    )}
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-zinc-800 text-slate-500 inline-flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      {lesson.views || 0}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Link
                      to={`/lessons/${lesson.id}`}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 transition"
                    >
                      <Play className="w-4 h-4 fill-black" />
                      <span>{t('watchLessonBtn')}</span>
                    </Link>
                    <button
                      onClick={() => handleToggleComplete(lesson.id)}
                      title={t('markCompleteBtn')}
                      className={`px-3 py-2.5 rounded-xl text-xs font-bold border transition ${
                        completed
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400'
                          : 'bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-500 hover:text-emerald-500'
                      }`}
                    >
                      {completed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* ---------------------- Extra video resources ---------------------- */}
      {libraryVideos.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Video className="w-5 h-5 text-yellow-500" />
            <span>{t('videoLibraryTitle')}</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {libraryVideos.map((v) => (
              <button
                key={v.id}
                onClick={() => setActiveVideo(v)}
                className="p-4 rounded-2xl bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-zinc-800 hover:border-yellow-400/50 transition text-start flex items-center gap-3"
              >
                <span className="w-10 h-10 rounded-xl bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 flex items-center justify-center shrink-0">
                  <Play className="w-5 h-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold truncate">{v.title}</span>
                  {v.description && (
                    <span className="block text-[11px] text-slate-400 truncate">{v.description}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Inline player for a library video */}
      {activeVideo && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 max-w-3xl w-full space-y-4 border border-slate-200 dark:border-zinc-800 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold text-base truncate">{activeVideo.title}</h3>
              <button onClick={() => setActiveVideo(null)} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <ProtectedVideoPlayer
              videoUrl={activeVideo.youtube_url || activeVideo.video_url}
              title={activeVideo.title}
              studentInfo={{
                name: profile?.full_name || user?.email || 'Physics Hub Student',
                phone: profile?.phone || '01xxxxxxxxx',
              }}
            />
          </div>
        </div>
      )}

      {/* Footer note — deliberately no homework links on this page */}
      <div className="p-4 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-[11px] text-slate-500 dark:text-zinc-400 font-bold flex items-center gap-2">
        <GraduationCap className="w-4 h-4 text-yellow-500 shrink-0" />
        <span>{t('lessonsPageFooterNote')}</span>
      </div>
    </div>
  )
}
