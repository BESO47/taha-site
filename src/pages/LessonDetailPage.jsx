import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Play, Download, MessageSquare, Send, Loader2, CheckCircle2, Circle,
  BookOpen, Clock, Eye, ChevronRight, ChevronLeft, FileText, Sparkles,
  Lock, LogIn, UserPlus,
} from 'lucide-react'
import { fetchLessonByIdFromSupabase, fetchLessonsFromSupabase } from '../lib/supabase'
import ProtectedVideoPlayer from '../components/ProtectedVideoPlayer'
import { useLanguage } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import {
  markLessonWatched, isLessonCompleted, setLessonCompleted, summarizeProgress,
} from '../lib/progress'

/**
 * =====================================================================
 * LESSON DETAIL  —  content delivery only
 * ---------------------------------------------------------------------
 * Video, description, downloadable materials, module navigation and the
 * discussion thread. Homework lives exclusively on /homework, so this
 * view never renders assignments, answer sheets or homework links.
 * =====================================================================
 */
export default function LessonDetailPage() {
  const { lang, t } = useLanguage()
  const { lessonId } = useParams()
  const { user, profile } = useAuth()

  const [lesson, setLesson] = useState(null)
  const [siblings, setSiblings] = useState([])
  const [loading, setLoading] = useState(true)
  const [completed, setCompleted] = useState(false)

  const [comments, setComments] = useState([
    { id: 1, name: 'أحمد محمود', time: 'منذ ساعتين', text: 'شرح رائع جداً يا هندسة، فكرة قانون أوم وضحت تماماً.' },
    { id: 2, name: 'مريم طارق', time: 'منذ 4 ساعات', text: 'مسائل التوالي والتوازي أصبحت أسهل بكتير بعد المشاهدة.' },
  ])
  const [newComment, setNewComment] = useState('')

  const studentInfo = useMemo(
    () => ({
      name: profile?.full_name || user?.email || 'طالب المنصة',
      phone: profile?.phone || '01xxxxxxxxx',
    }),
    [profile?.full_name, profile?.phone, user?.email]
  )

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      const [data, all] = await Promise.all([
        fetchLessonByIdFromSupabase(lessonId),
        fetchLessonsFromSupabase(),
      ])
      if (!alive) return
      setLesson(data)
      setSiblings(Array.isArray(all) ? all : [])
      setLoading(false)

      // Progress: opening the lesson marks it as "in progress"
      if (data) {
        markLessonWatched(user?.id, data.id)
        setCompleted(isLessonCompleted(user?.id, data.id))
      }
    }
    load()
    return () => { alive = false }
  }, [lessonId, user?.id])

  const moduleLessons = useMemo(() => {
    if (!lesson) return []
    return siblings.filter(
      (l) => String(l.yearId) === String(lesson.yearId) && (l.unit || '') === (lesson.unit || '')
    )
  }, [siblings, lesson])

  const currentIndex = moduleLessons.findIndex((l) => String(l.id) === String(lessonId))
  const prevLesson = currentIndex > 0 ? moduleLessons[currentIndex - 1] : null
  const nextLesson = currentIndex >= 0 && currentIndex < moduleLessons.length - 1 ? moduleLessons[currentIndex + 1] : null
  const moduleProgress = summarizeProgress(user?.id, moduleLessons)

  const handleToggleComplete = () => {
    const next = !completed
    setLessonCompleted(user?.id, lessonId, next)
    setCompleted(next)
  }

  const handleAddComment = (e) => {
    e.preventDefault()
    if (!newComment.trim()) return
    setComments((prev) => [
      { id: Date.now(), name: studentInfo.name, time: lang === 'ar' ? 'الآن' : 'just now', text: newComment.trim() },
      ...prev,
    ])
    setNewComment('')
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-yellow-500 font-bold">
        <Loader2 className="w-10 h-10 animate-spin" />
        <span>{t('loading')}</span>
      </div>
    )
  }

  if (!lesson) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-4">
        <h2 className="text-xl font-bold text-slate-700 dark:text-zinc-200">
          {lang === 'ar' ? 'عذراً، الدرس غير موجود أو تم حذفه' : 'Sorry, lesson not found or deleted.'}
        </h2>
        <Link to="/lessons" className="px-6 py-2.5 rounded-xl bg-yellow-400 text-black font-bold text-sm">
          {t('lessonsPageTitle')}
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen py-8 px-4 sm:px-8 max-w-6xl mx-auto space-y-8 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* Breadcrumbs — lessons only */}
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-400 flex-wrap">
        <Link to="/" className="hover:text-yellow-600 dark:hover:text-yellow-400">{t('navHome')}</Link>
        <span>/</span>
        <Link to="/lessons" className="hover:text-yellow-600 dark:hover:text-yellow-400">{t('lessonsPageTitle')}</Link>
        <span>/</span>
        <span className="text-slate-900 dark:text-white font-bold truncate max-w-[250px]">{lesson.title}</span>
      </div>

      {/* ---------------------- Header & video ---------------------- */}
      <div className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="px-3.5 py-1 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-800 dark:text-yellow-300 border border-yellow-400/30">
              ⚡ {lesson.branch || 'Physics'}
            </span>
            <span className="text-xs text-slate-500 dark:text-zinc-400 font-bold">{lesson.unit}</span>
            <span className="text-xs text-slate-500 dark:text-zinc-400 font-bold flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-yellow-500" />{lesson.duration}
            </span>
            <span className="text-xs text-slate-500 dark:text-zinc-400 font-bold flex items-center gap-1">
              <Eye className="w-3.5 h-3.5 text-yellow-500" />{lesson.views || 0}
            </span>

            <button
              onClick={handleToggleComplete}
              className={`ms-auto px-3.5 py-1.5 rounded-full text-xs font-extrabold border inline-flex items-center gap-1.5 transition ${
                completed
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                  : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:text-emerald-500'
              }`}
            >
              {completed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
              <span>{completed ? t('completedLabel') : t('markCompleteBtn')}</span>
            </button>
          </div>

          <h1 className="text-2xl sm:text-4xl font-bold font-outfit text-slate-900 dark:text-white">
            {lesson.title}
          </h1>
        </div>

        {/* Lesson videos are for registered students (membership gate only —
            no homework requirement: homework lives on /homework). */}
        {user ? (
          <ProtectedVideoPlayer
            videoUrl={lesson.videoUrl}
            title={lesson.title}
            studentInfo={studentInfo}
          />
        ) : (
          <div className="rounded-3xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-amber-500 text-white flex items-center justify-center mx-auto shadow-lg">
              <Lock className="w-7 h-7" />
            </div>
            <p className="font-extrabold text-amber-800 dark:text-amber-300">{t('loginToWatch')}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/login"
                className="px-6 py-3 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-sm inline-flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                <span>{t('navLogin')}</span>
              </Link>
              <Link
                to="/register"
                className="px-6 py-3 rounded-2xl border border-yellow-400/60 text-yellow-700 dark:text-yellow-300 font-bold text-sm inline-flex items-center justify-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                <span>{t('navRegister')}</span>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* --------------------- Description & materials --------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
          <h2 className="text-lg font-bold font-outfit flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-yellow-500" />
            <span>{t('aboutLessonTitle')}</span>
          </h2>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-300 whitespace-pre-line">
            {lesson.description || t('noLessonDescription')}
          </p>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
          <h2 className="text-lg font-bold font-outfit flex items-center gap-2">
            <FileText className="w-5 h-5 text-yellow-500" />
            <span>{t('lessonMaterialsTitle')}</span>
          </h2>

          {lesson.summaryPdfUrl ? (
            <a
              href={lesson.summaryPdfUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-zinc-800 hover:border-yellow-400/50 transition group"
            >
              <span className="w-10 h-10 rounded-xl bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 flex items-center justify-center shrink-0">
                <Download className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold truncate group-hover:text-yellow-500 transition">
                  {lesson.summaryPdfName || t('lessonSummaryPdf')}
                </span>
                <span className="block text-[11px] text-slate-400 font-bold">PDF</span>
              </span>
            </a>
          ) : (
            <p className="text-xs text-slate-400 font-bold py-4 text-center">— {t('noMaterialsYet')} —</p>
          )}

          {/* Module progress */}
          <div className="pt-2 border-t border-slate-200 dark:border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
                {t('modulesProgressTitle')}
              </span>
              <span className="font-mono text-slate-400">
                {moduleProgress.completed}/{moduleProgress.total}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${moduleProgress.percent}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------- Module navigation ---------------------- */}
      {(prevLesson || nextLesson) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {prevLesson ? (
            <Link
              to={`/lessons/${prevLesson.id}`}
              className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:border-yellow-400/50 transition flex items-center gap-3"
            >
              <ChevronLeft className="w-5 h-5 text-yellow-500 shrink-0 rtl:rotate-180" />
              <span className="min-w-0">
                <span className="block text-[11px] font-bold text-slate-400">{t('previousLesson')}</span>
                <span className="block text-xs font-bold truncate">{prevLesson.title}</span>
              </span>
            </Link>
          ) : <span />}

          {nextLesson && (
            <Link
              to={`/lessons/${nextLesson.id}`}
              className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:border-yellow-400/50 transition flex items-center gap-3 sm:justify-end text-end"
            >
              <span className="min-w-0">
                <span className="block text-[11px] font-bold text-slate-400">{t('nextLesson')}</span>
                <span className="block text-xs font-bold truncate">{nextLesson.title}</span>
              </span>
              <ChevronRight className="w-5 h-5 text-yellow-500 shrink-0 rtl:rotate-180" />
            </Link>
          )}
        </div>
      )}

      {/* -------------------------- Discussion -------------------------- */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-6">
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-zinc-800 pb-4">
          <MessageSquare className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
          <h3 className="text-xl font-bold font-outfit text-slate-900 dark:text-white">
            {t('discussionsHeader')}
          </h3>
        </div>

        <form onSubmit={handleAddComment} className="flex gap-3">
          <input
            type="text"
            placeholder={t('commentPlaceholder')}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
          <button
            type="submit"
            className="px-6 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-sm flex items-center gap-2 shrink-0 transition"
          >
            <span>{t('sendComment')}</span>
            <Send className="w-4 h-4" />
          </button>
        </form>

        <div className="space-y-4 pt-2">
          {comments.map((c) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800 space-y-1.5"
            >
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-zinc-300">
                <span>{c.name}</span>
                <span className="text-slate-400 dark:text-zinc-500 font-normal">{c.time}</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-zinc-300">{c.text}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Continue watching */}
      <div className="flex justify-center">
        <Link
          to="/lessons"
          className="px-6 py-3 rounded-2xl bg-slate-900 dark:bg-zinc-800 text-white font-bold text-sm inline-flex items-center gap-2 hover:bg-slate-800 transition"
        >
          <Play className="w-4 h-4 fill-white" />
          <span>{t('backToLessons')}</span>
        </Link>
      </div>
    </div>
  )
}
