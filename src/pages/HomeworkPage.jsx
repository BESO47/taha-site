import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'
import {
  ClipboardList, Lock, Unlock, Play, CheckCircle2, Sparkles,
  Loader2, Award, ChevronRight, HelpCircle, X, Send, BookOpen, AlertCircle
} from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import { YEARS } from '../data/dummyData'
import { fetchLessonsFromSupabase } from '../lib/supabase'
import { fetchHomeworkSubmission, submitHomeworkSubmission, fetchSubmissionsForStudentLessons } from '../lib/api'

/**
 * Placeholder answer sheet used when a lesson has no homework questions
 * configured yet. It carries its own answer key so the marker always has
 * something to compare the student's answers against.
 */
const DEFAULT_HOMEWORK_QUESTIONS = [1, 2, 3, 4, 5].map((n) => ({
  id: String(n),
  question: `السؤال ${n}: اختر رمز الإجابة الصحيحة:`,
  options: ['A) الخيار الأول', 'B) الخيار الثاني', 'C) الخيار الثالث', 'D) الخيار الرابع'],
  correctAnswer: ['A', 'B', 'C', 'A', 'B'][n - 1],
  points: 1,
}))

/** The questions actually shown / marked for a lesson. */
const questionsOf = (lesson) =>
  lesson?.homeworkQuestions?.length ? lesson.homeworkQuestions : DEFAULT_HOMEWORK_QUESTIONS

export default function HomeworkPage() {
  const { t, lang } = useLanguage()
  const { user, profile, isAdmin } = useAuth()

  const [lessons, setLessons] = useState([])
  const [submissions, setSubmissions] = useState({})
  const [loading, setLoading] = useState(true)
  const [yearFilter, setYearFilter] = useState('all')

  // Homework Solver Modal State
  const [activeLesson, setActiveLesson] = useState(null)
  const [userAnswers, setUserAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const allLessons = await fetchLessonsFromSupabase()
      setLessons(allLessons)

      if (user?.id) {
        const studentSubs = await fetchSubmissionsForStudentLessons(user.id)
        const map = {}
        studentSubs.forEach((s) => {
          map[s.lessonId] = s
        })

        // Also check individual lessons to ensure synced state
        for (const l of allLessons) {
          if (!map[l.id]) {
            const single = await fetchHomeworkSubmission({ lessonId: l.id, studentId: user.id })
            if (single) map[l.id] = single
          }
        }
        setSubmissions(map)
      }
    } catch (err) {
      console.error('Failed to load homework data:', err)
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (profile?.year_id) {
      setYearFilter(profile.year_id)
    }
  }, [profile?.year_id])

  const openHomeworkModal = (lesson) => {
    setActiveLesson(lesson)
    const existing = submissions[lesson.id]
    if (existing?.answers) {
      setUserAnswers(existing.answers)
    } else {
      setUserAnswers({})
    }
    setSubmitResult(null)
  }

  const handleOptionSelect = (qId, optionChoice) => {
    setUserAnswers((prev) => ({
      ...prev,
      [String(qId)]: optionChoice,
    }))
  }

  const handleHomeworkSubmit = async (e) => {
    e.preventDefault()
    if (!activeLesson || !user?.id) return

    const questions = questionsOf(activeLesson)
    const totalQ = questions.length || Object.keys(activeLesson.modelAnswers || {}).length || 5

    // Validate that at least one answer is selected
    if (Object.keys(userAnswers).length === 0) {
      alert(lang === 'ar' ? 'يرجى الإجابة على الأسئلة أولاً قبل التسليم.' : 'Please answer the questions before submitting.')
      return
    }

    setSubmitting(true)
    try {
      const result = await submitHomeworkSubmission({
        lessonId: activeLesson.id,
        studentId: user.id,
        answers: userAnswers,
        questions,
        modelAnswers: activeLesson.modelAnswers || {},
        totalQuestions: totalQ,
      })

      setSubmissions((prev) => ({
        ...prev,
        [activeLesson.id]: result,
      }))

      setSubmitResult(result)

      // Confetti animation
      try {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        })
      } catch (_) {}
    } catch (err) {
      console.error(err)
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const filteredLessons = lessons.filter((l) => {
    return yearFilter === 'all' || String(l.yearId) === String(yearFilter)
  })

  // Quick stats
  const totalCount = filteredLessons.length
  const completedCount = filteredLessons.filter((l) => Boolean(submissions[l.id]) || isAdmin).length
  const pendingCount = Math.max(0, totalCount - completedCount)

  return (
    <div className="min-h-screen py-10 px-4 sm:px-8 max-w-7xl mx-auto space-y-8 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* Header Banner */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl bg-slate-900 dark:bg-zinc-900 text-white p-8 sm:p-12 shadow-2xl border border-slate-800 dark:border-yellow-400/30 space-y-6"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-yellow-400/20 border border-yellow-400/40 text-xs font-bold text-yellow-300">
              <Sparkles className="w-4 h-4 text-yellow-400" />
              <span>{t('slogan')}</span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-extrabold font-outfit">{t('homeworkTitle')}</h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              {t('homeworkSubtitle')}
            </p>
          </div>

          {/* Mini Stats Bar */}
          <div className="grid grid-cols-2 gap-3 shrink-0">
            <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-center">
              <div className="text-2xl font-extrabold text-emerald-400 font-outfit">{completedCount}</div>
              <div className="text-xs text-slate-300 font-bold">{lang === 'ar' ? 'فيديوهات مفتوحة' : 'Unlocked Videos'}</div>
            </div>
            <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-center">
              <div className="text-2xl font-extrabold text-amber-400 font-outfit">{pendingCount}</div>
              <div className="text-xs text-slate-300 font-bold">{lang === 'ar' ? 'واجبات مطلوبة' : 'Pending Tasks'}</div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Grade filter */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setYearFilter('all')}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition ${
              yearFilter === 'all'
                ? 'bg-yellow-400 text-black shadow-md'
                : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-800'
            }`}
          >
            {t('allGrades')}
          </button>
          {YEARS.map((y) => (
            <button
              key={y.id}
              onClick={() => setYearFilter(y.id)}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm transition ${
                yearFilter === y.id
                  ? 'bg-yellow-400 text-black shadow-md'
                  : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-800'
              }`}
            >
              {lang === 'ar' ? y.shortTitleAr : y.shortTitle}
            </button>
          ))}
        </div>

        {profile?.group_name && (
          <div className="px-4 py-2 rounded-xl bg-yellow-400/15 border border-yellow-400/30 text-xs font-bold text-yellow-700 dark:text-yellow-300">
            {t('studentGroup')}: {profile.group_name}
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-yellow-500 flex flex-col items-center gap-3 font-bold">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span>{t('loading')}</span>
        </div>
      ) : filteredLessons.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-3xl border border-dashed border-slate-300 dark:border-zinc-800 text-slate-500 space-y-3">
          <ClipboardList className="w-12 h-12 mx-auto text-slate-400 dark:text-zinc-600" />
          <p className="font-bold text-lg">{t('noLessonsFound')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredLessons.map((lesson) => {
            const sub = submissions[lesson.id]
            const isUnlocked = Boolean(sub) || isAdmin
            const questionsCount = lesson.homeworkQuestions?.length || 5

            return (
              <motion.div
                key={lesson.id}
                whileHover={{ y: -4 }}
                className={`bg-white dark:bg-zinc-900 rounded-3xl border p-6 flex flex-col justify-between shadow-sm transition group relative ${
                  isUnlocked
                    ? 'border-emerald-200 dark:border-emerald-950/80 hover:border-emerald-400'
                    : 'border-slate-200 dark:border-zinc-800 hover:border-yellow-400/50'
                }`}
              >
                <div className="space-y-4">
                  {/* Status Badges */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-800 dark:text-yellow-300 border border-yellow-400/30">
                      ⚡ {lesson.branch || 'Physics'}
                    </span>

                    {isUnlocked ? (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 flex items-center gap-1.5">
                        <Unlock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>{t('unlockedStatus')}</span>
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        <span>{t('lockedStatus')}</span>
                      </span>
                    )}
                  </div>

                  {/* Title & Unit */}
                  <div>
                    <span className="text-[11px] font-bold text-slate-400 block mb-1">{lesson.unit}</span>
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-snug">
                      {lesson.title}
                    </h3>
                  </div>

                  {/* Homework Score Banner if submitted — marked against the answer key */}
                  {sub && (
                    <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 space-y-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Award className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          <span>{t('yourSubmittedScore')}:</span>
                        </div>
                        <span className="font-mono text-sm px-2.5 py-0.5 rounded-lg bg-emerald-200/50 dark:bg-emerald-900/60">
                          {sub.score} / {sub.totalPoints || sub.totalQuestions} ({sub.percentage ?? 0}%)
                        </span>
                      </div>
                      {sub.correctCount != null && (
                        <div className="flex items-center gap-2 flex-wrap text-[11px]">
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-200/60 dark:bg-emerald-900/60">
                            ✓ {t('correctAnswersLabel')}: {sub.correctCount}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                            ✕ {t('incorrectAnswersLabel')}: {sub.incorrectCount ?? 0}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {!sub && !isAdmin && (
                    <div className="p-3 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800 text-xs text-slate-500 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>{lang === 'ar' ? 'حل الواجب لفتح فيديو الدرس ومشاهدة الشرح' : 'Submit homework to unlock the video lesson'}</span>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="pt-6 space-y-2">
                  {isUnlocked ? (
                    <div className="space-y-2">
                      <Link
                        to={`/lessons/${lesson.id}`}
                        className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md transition"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        <span>{lang === 'ar' ? 'مشاهدة فيديو الدرس المفتوح 🎬' : 'Watch Unlocked Video 🎬'}</span>
                      </Link>

                      <button
                        onClick={() => openHomeworkModal(lesson)}
                        className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-xs font-bold text-slate-700 dark:text-zinc-300 flex items-center justify-center gap-1.5 transition"
                      >
                        <ClipboardList className="w-3.5 h-3.5" />
                        <span>{t('retakeHomework')}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => openHomeworkModal(lesson)}
                      className="w-full py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-yellow-400/20 transition"
                    >
                      <ClipboardList className="w-4 h-4" />
                      <span>{lang === 'ar' ? 'حل الواجب لفتح الفيديو ✍️' : 'Solve Homework to Unlock ✍️'}</span>
                    </button>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Interactive Homework Solver Modal */}
      <AnimatePresence>
        {activeLesson && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-3xl w-full space-y-6 max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-zinc-800 text-slate-900 dark:text-white"
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-zinc-800 pb-4">
                <div>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-800 dark:text-yellow-300 border border-yellow-400/30 inline-block mb-2">
                    ⚡ {activeLesson.branch}
                  </span>
                  <h2 className="text-xl sm:text-2xl font-bold font-outfit">{activeLesson.title}</h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">{t('solveHomeworkModalTitle')}</p>
                </div>
                <button
                  onClick={() => {
                    setActiveLesson(null)
                    setSubmitResult(null)
                  }}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Success Result View */}
              {submitResult ? (
                <div className="p-6 rounded-3xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-center space-y-5">
                  <div className="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-xl">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-2xl font-extrabold text-emerald-800 dark:text-emerald-300 font-outfit">
                      {lang === 'ar' ? '🎉 تم تسليم الواجب بنجاح!' : '🎉 Homework Submitted Successfully!'}
                    </h3>
                    <p className="text-sm text-emerald-700 dark:text-emerald-200">
                      {t('videoUnlockedBanner')}
                    </p>
                  </div>

                  <div className="inline-block px-6 py-3 rounded-2xl bg-white dark:bg-zinc-900 border border-emerald-300 dark:border-emerald-700 shadow-md">
                    <div className="text-xs font-bold text-slate-500">{t('homeworkScoreLabel')}</div>
                    <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 font-outfit">
                      {submitResult.score} / {submitResult.totalPoints || submitResult.totalQuestions} ({submitResult.percentage ?? 0}%)
                    </div>
                  </div>

                  {/* Correct / incorrect breakdown — computed by comparing
                      every answer with the teacher's answer key. */}
                  <div className="grid grid-cols-3 gap-2 max-w-md mx-auto">
                    <div className="p-3 rounded-2xl bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800">
                      <div className="text-[11px] font-bold text-slate-500">{t('correctAnswersLabel')}</div>
                      <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{submitResult.correctCount ?? 0}</div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900">
                      <div className="text-[11px] font-bold text-slate-500">{t('incorrectAnswersLabel')}</div>
                      <div className="text-xl font-extrabold text-red-600 dark:text-red-400">{submitResult.incorrectCount ?? 0}</div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                      <div className="text-[11px] font-bold text-slate-500">{t('percentageLabel')}</div>
                      <div className="text-xl font-extrabold text-slate-800 dark:text-white">{submitResult.percentage ?? 0}%</div>
                    </div>
                  </div>

                  {/* Per-question review */}
                  {Array.isArray(submitResult.breakdown) && submitResult.breakdown.length > 0 && (
                    <div className="text-start space-y-2 max-h-64 overflow-y-auto">
                      <p className="text-xs font-bold text-slate-500">{t('answerReviewTitle')}</p>
                      {submitResult.breakdown.map((b) => (
                        <div
                          key={b.questionId || b.number}
                          className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-between gap-3 ${
                            b.isCorrect
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
                          }`}
                        >
                          <span className="truncate">
                            {b.number}. {b.question || ''}
                          </span>
                          <span className="font-mono shrink-0">
                            {b.isCorrect
                              ? `✓ ${b.studentLetter || b.studentAnswer}`
                              : `✕ ${b.studentLetter || b.studentAnswer || '—'} → ${b.correctAnswer || b.correctLetter || '—'}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                    <Link
                      to={`/lessons/${activeLesson.id}`}
                      className="px-8 py-3.5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg transition"
                    >
                      <Play className="w-4 h-4 fill-black" />
                      <span>{lang === 'ar' ? 'مشاهدة فيديو الدرس الآن 🎬' : 'Watch Lesson Video Now 🎬'}</span>
                    </Link>
                    <button
                      onClick={() => setActiveLesson(null)}
                      className="px-6 py-3.5 rounded-2xl bg-slate-200 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 font-bold text-sm hover:bg-slate-300 transition"
                    >
                      {lang === 'ar' ? 'إغلاق' : 'Close'}
                    </button>
                  </div>
                </div>
              ) : (
                /* Interactive Homework Questions Form */
                <form onSubmit={handleHomeworkSubmit} className="space-y-6">
                  <div className="p-4 rounded-2xl bg-yellow-400/10 border border-yellow-400/30 text-xs font-bold text-yellow-800 dark:text-yellow-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{t('homeworkGatingSubNotice')}</span>
                  </div>

                  {/* Questions List */}
                  <div className="space-y-5">
                    {questionsOf(activeLesson).map((q, idx) => {
                      const qKey = String(q.id || idx + 1)
                      const selectedChoice = userAnswers[qKey]

                      return (
                        <div
                          key={qKey}
                          className="p-5 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800 space-y-4"
                        >
                          <div className="flex items-start gap-3">
                            <span className="w-7 h-7 rounded-lg bg-yellow-400 text-black flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <span className="font-bold text-sm sm:text-base leading-snug">
                              {q.question}
                            </span>
                          </div>

                          {/* Options selector (A, B, C, D) */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 ltr:pl-10 rtl:pr-10">
                            {(q.options || ['A) الخيار أ', 'B) الخيار ب', 'C) الخيار ج', 'D) الخيار د']).map((opt, optIdx) => {
                              const letter = ['A', 'B', 'C', 'D'][optIdx] || String(optIdx + 1)
                              const isSelected = selectedChoice === letter || selectedChoice === opt

                              return (
                                <button
                                  key={optIdx}
                                  type="button"
                                  onClick={() => handleOptionSelect(qKey, letter)}
                                  className={`p-3 rounded-xl border text-sm font-bold text-start flex items-center justify-between transition ${
                                    isSelected
                                      ? 'bg-yellow-400 border-yellow-500 text-black shadow-sm'
                                      : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 hover:border-yellow-400/60'
                                  }`}
                                >
                                  <span>{opt}</span>
                                  {isSelected && <CheckCircle2 className="w-4 h-4 text-black shrink-0" />}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Submission Buttons */}
                  <div className="flex gap-3 pt-4 border-t border-slate-200 dark:border-zinc-800">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 py-3.5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg transition"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>{t('submittingHomework')}</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-5 h-5" />
                          <span>{t('submitHomeworkBtn')}</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveLesson(null)}
                      className="px-6 py-3.5 rounded-2xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm hover:bg-slate-200 transition"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
