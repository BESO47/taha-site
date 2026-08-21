import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'
import {
  Play, Download, HelpCircle, MessageSquare, Send, Sparkles,
  Loader2, Lock, Unlock, CheckCircle2, XCircle, Award, AlertTriangle,
  ClipboardList, ArrowDown, Check, RefreshCw
} from 'lucide-react'
import { fetchLessonByIdFromSupabase, supabase } from '../lib/supabase'
import { fetchHomeworkSubmission, submitHomeworkSubmission } from '../lib/api'
import ProtectedVideoPlayer from '../components/ProtectedVideoPlayer'
import { useLanguage } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'

export default function LessonDetailPage() {
  const { lang, t } = useLanguage()
  const { lessonId } = useParams()
  const { user, profile, isAdmin } = useAuth()

  const [lesson, setLesson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [studentInfo, setStudentInfo] = useState({
    name: 'طالب المنصة',
    phone: '01xxxxxxxxx',
  })

  // Homework & Video Gating State
  const [homeworkSubmission, setHomeworkSubmission] = useState(null)
  const [checkingHomework, setCheckingHomework] = useState(true)
  const [userAnswers, setUserAnswers] = useState({})
  const [isSubmittingHomework, setIsSubmittingHomework] = useState(false)
  const [homeworkSubmittedJustNow, setHomeworkSubmittedJustNow] = useState(false)

  // Comments state
  const [comments, setComments] = useState([
    { id: 1, name: 'أحمد محمود', time: 'منذ ساعتين', text: 'شرح رائع جداً يا هندسة، فكرة قانون أوم وضحت تماماً.' },
    { id: 2, name: 'مريم طارق', time: 'منذ 4 ساعات', text: 'مسائل التوالي والتوازي أصبحت أسهل بكتير بعد حل الواجب.' },
  ])
  const [newComment, setNewComment] = useState('')

  const homeworkSectionRef = useRef(null)
  const videoPlayerSectionRef = useRef(null)

  useEffect(() => {
    async function loadLessonAndUser() {
      setLoading(true)
      const data = await fetchLessonByIdFromSupabase(lessonId)
      setLesson(data)

      if (profile) {
        setStudentInfo({
          name: profile.full_name || user?.email || 'طالب المنصة',
          phone: profile.phone || '01xxxxxxxxx',
        })
      } else if (user) {
        setStudentInfo({
          name: user.email || 'طالب المنصة',
          phone: '01xxxxxxxxx',
        })
      }

      setLoading(false)
    }
    loadLessonAndUser()
  }, [lessonId, profile, user])

  // Check student's homework submission for this specific lesson
  useEffect(() => {
    async function checkSubmission() {
      if (!lessonId || !user?.id) {
        setCheckingHomework(false)
        return
      }
      setCheckingHomework(true)
      try {
        const sub = await fetchHomeworkSubmission({ lessonId, studentId: user.id })
        if (sub) {
          setHomeworkSubmission(sub)
          if (sub.answers) setUserAnswers(sub.answers)
        }
      } catch (err) {
        console.warn('Error checking homework submission:', err)
      } finally {
        setCheckingHomework(false)
      }
    }

    checkSubmission()
  }, [lessonId, user?.id])

  const isVideoUnlocked = Boolean(homeworkSubmission) || isAdmin

  const scrollToHomework = () => {
    if (homeworkSectionRef.current) {
      homeworkSectionRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const scrollToVideo = () => {
    if (videoPlayerSectionRef.current) {
      videoPlayerSectionRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleOptionSelect = (qId, optionChoice) => {
    setUserAnswers((prev) => ({ ...prev, [String(qId)]: optionChoice }))
  }

  const handleHomeworkSubmit = async (e) => {
    e.preventDefault()
    if (!lesson || !user?.id) return

    const questions = lesson.homeworkQuestions || []
    const totalQ = questions.length || Object.keys(lesson.modelAnswers || {}).length || 5

    if (Object.keys(userAnswers).length === 0) {
      alert(lang === 'ar' ? 'يرجى الإجابة على أسئلة الواجب أولاً.' : 'Please answer the questions first.')
      return
    }

    setIsSubmittingHomework(true)
    try {
      const result = await submitHomeworkSubmission({
        lessonId: lesson.id,
        studentId: user.id,
        answers: userAnswers,
        modelAnswers: lesson.modelAnswers || {},
        totalQuestions: totalQ,
      })

      setHomeworkSubmission(result)
      setHomeworkSubmittedJustNow(true)

      // Confetti celebration
      try {
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
        })
      } catch (_) {}

      // Smooth scroll back to unlocked video
      setTimeout(() => {
        scrollToVideo()
      }, 300)
    } catch (err) {
      console.error('Homework submission error:', err)
      alert(err.message)
    } finally {
      setIsSubmittingHomework(false)
    }
  }

  const handleAddComment = (e) => {
    e.preventDefault()
    if (!newComment.trim()) return
    setComments([
      { id: Date.now(), name: studentInfo.name, time: t('now'), text: newComment },
      ...comments,
    ])
    setNewComment('')
  }

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3 font-ibm text-yellow-600 dark:text-yellow-400 font-bold bg-slate-50 dark:bg-black">
        <Loader2 className="w-10 h-10 animate-spin" />
        <span>{lang === 'ar' ? 'جاري جلب تفاصيل درس الفيزياء...' : 'Loading physics lesson details...'}</span>
      </div>
    )
  }

  if (!lesson) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4 font-ibm text-center px-4 bg-slate-50 dark:bg-black">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">
          {lang === 'ar' ? 'عذراً، الدرس غير موجود أو تم حذفه' : 'Sorry, lesson not found or deleted.'}
        </h2>
        <Link to="/" className="px-6 py-2.5 rounded-xl bg-yellow-400 text-black font-bold text-sm">
          {t('navHome')}
        </Link>
      </div>
    )
  }

  const questionsList = lesson.homeworkQuestions && lesson.homeworkQuestions.length > 0
    ? lesson.homeworkQuestions
    : [
        {
          id: '1',
          question: 'إذا زاد طول سلك نحاسي إلى الضعف ونقصت مساحة مقطعه للنصف، فإن مقاومته الكهربية:',
          options: ['A) تزداد إلى 4 أمثالها', 'B) تقل إلى النصف', 'C) تظل ثابتة', 'D) تزداد للضعف'],
          correctAnswer: 'A',
        },
        {
          id: '2',
          question: 'وحدة قياس المقاومة النوعية لمادة موصل في النظام الدولي هي:',
          options: ['A) أوم / متر', 'B) أوم . متر', 'C) أمبير / فولت', 'D) فولت . متر'],
          correctAnswer: 'B',
        },
        {
          id: '3',
          question: 'عند ثبوت درجة الحرارة، تتناسب شدة التيار المار في موصل مع فرق الجهد بين طرفيه تناسباً:',
          options: ['A) طردياً', 'B) عكسياً', 'C) تربيعياً', 'D) لا يتأثر'],
          correctAnswer: 'A',
        },
        {
          id: '4',
          question: 'موصل مقاومته 10 أوم يمر به تيار 2 أمبير، فإذا زاد التيار إلى 4 أمبير مع ثبوت الحرارة، فإن مقاومته:',
          options: ['A) تصبح 20 أوم', 'B) تصبح 5 أوم', 'C) تظل 10 أوم', 'D) تصبح 40 أوم'],
          correctAnswer: 'C',
        },
        {
          id: '5',
          question: 'حاصل ضرب المقاومة النوعية لمادة في التوصيلية الكهربية لها يساوي دائماً:',
          options: ['A) صفراً', 'B) الواحد الصحيح', 'C) يعتمد على نوع المادة', 'D) يعتمد على مساحة المقطع'],
          correctAnswer: 'B',
        },
      ]

  return (
    <div className="min-h-screen py-8 px-4 sm:px-8 max-w-6xl mx-auto space-y-10 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-400">
        <Link to="/" className="hover:text-yellow-600 dark:hover:text-yellow-400">
          {t('navHome')}
        </Link>
        <span>/</span>
        <Link to="/homework" className="hover:text-yellow-600 dark:hover:text-yellow-400">
          {t('navHomework')}
        </Link>
        <span>/</span>
        <span className="text-slate-900 dark:text-white font-bold truncate max-w-[250px]">{lesson.title}</span>
      </div>

      {/* Main Lesson Header & Video Section */}
      <div ref={videoPlayerSectionRef} className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="px-3.5 py-1 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-800 dark:text-yellow-300 border border-yellow-400/30">
              ⚡ {lesson.branch || 'Physics'}
            </span>
            <span className="text-xs text-slate-500 dark:text-zinc-400 font-bold">{lesson.unit}</span>

            {/* Video Unlock Pill */}
            {isVideoUnlocked ? (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 flex items-center gap-1.5 ms-auto">
                <Unlock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{t('unlockedStatus')}</span>
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700 flex items-center gap-1.5 ms-auto">
                <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>{t('lockedStatus')}</span>
              </span>
            )}
          </div>

          <h1 className="text-2xl sm:text-4xl font-bold font-outfit text-slate-900 dark:text-white">
            {lesson.title}
          </h1>
        </div>

        {/* =========================================================================
            FEATURE 1: CONTENT GATE (VIDEO PLAYER VS HOMEWORK REQUIREMENT PROMPT)
           ========================================================================= */}
        {isVideoUnlocked ? (
          <div className="space-y-4">
            {/* Unlocked Score Banner */}
            {homeworkSubmission && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 sm:p-5 rounded-3xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 text-emerald-900 dark:text-emerald-200 font-bold text-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-md">
                    <Check className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-base font-extrabold text-emerald-800 dark:text-emerald-300 font-outfit">
                      {lang === 'ar' ? '🎉 تم فتح فيديو هذا الدرس بنجاح' : '🎉 Lesson Video Unlocked!'}
                    </div>
                    <div className="text-xs text-emerald-700 dark:text-emerald-300 font-normal">
                      {lang === 'ar'
                        ? `تم تسليم الواجب بنجاح في ${homeworkSubmission.submittedAt ? new Date(homeworkSubmission.submittedAt).toLocaleDateString('ar-EG') : 'اليوم'}`
                        : `Homework submitted on ${homeworkSubmission.submittedAt ? new Date(homeworkSubmission.submittedAt).toLocaleDateString() : 'today'}`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="px-4 py-2 rounded-2xl bg-emerald-100 dark:bg-emerald-900/60 border border-emerald-300 dark:border-emerald-700 text-center">
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-300 block font-bold">
                      {t('homeworkScoreLabel')}
                    </span>
                    <span className="text-lg font-extrabold text-emerald-800 dark:text-emerald-200 font-outfit">
                      {homeworkSubmission.score} / {homeworkSubmission.totalQuestions} ({homeworkSubmission.totalQuestions > 0 ? Math.round((homeworkSubmission.score / homeworkSubmission.totalQuestions) * 100) : 0}%)
                    </span>
                  </div>

                  <button
                    onClick={scrollToHomework}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{t('retakeHomework')}</span>
                  </button>
                </div>
              </motion.div>
            )}

            {/* Unlocked Protected Video Player */}
            <ProtectedVideoPlayer
              videoUrl={lesson.videoUrl}
              title={lesson.title}
              studentInfo={studentInfo}
            />
          </div>
        ) : (
          /* =========================================================================
             LOCKED PROMPT / GATE SCREEN
             ========================================================================= */
          <div className="w-full aspect-video rounded-3xl overflow-hidden bg-slate-950 border-2 border-yellow-500/40 p-6 sm:p-12 flex flex-col items-center justify-center text-center space-y-6 shadow-2xl relative">
            {/* Background glowing particles */}
            <div className="absolute inset-0 bg-radial from-yellow-500/10 via-transparent to-black pointer-events-none" />

            <div className="relative z-10 w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-yellow-400/20 border-2 border-yellow-400 text-yellow-400 flex items-center justify-center shadow-2xl shadow-yellow-400/20 animate-pulse">
              <Lock className="w-10 h-10 sm:w-12 sm:h-12" />
            </div>

            <div className="relative z-10 space-y-2 max-w-xl">
              <span className="px-3.5 py-1 rounded-full bg-yellow-400/20 text-yellow-300 border border-yellow-400/30 text-xs font-bold inline-block">
                🔒 {lang === 'ar' ? 'محتوى الفيديو مقفل' : 'Video Content Locked'}
              </span>
              <h2 className="text-xl sm:text-3xl font-extrabold text-white font-outfit leading-tight">
                {t('homeworkGatingNotice')}
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {t('homeworkGatingSubNotice')}
              </p>
            </div>

            <div className="relative z-10 pt-2 flex flex-col sm:flex-row gap-3">
              <button
                onClick={scrollToHomework}
                className="px-8 py-3.5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-sm sm:text-base shadow-xl shadow-yellow-400/20 hover:scale-105 transition flex items-center justify-center gap-2"
              >
                <ClipboardList className="w-5 h-5" />
                <span>{t('solveHomeworkToUnlock')}</span>
                <ArrowDown className="w-4 h-4 animate-bounce" />
              </button>
            </div>
          </div>
        )}

        {/* Lesson Description & Material Downloads */}
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2 max-w-2xl">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-outfit">{t('aboutLesson')}</h2>
            <p className="text-sm text-slate-600 dark:text-zinc-300 leading-relaxed">
              {lesson.description || t('noLessonDesc')}
            </p>
          </div>

          {lesson.summaryPdfUrl && (
            <div className="w-full md:w-auto">
              <a
                href={lesson.summaryPdfUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full md:w-auto px-6 py-3.5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-sm shadow-md flex items-center justify-center gap-2 transition"
              >
                <Download className="w-5 h-5" />
                <span>{t('downloadPDFSummary')}</span>
              </a>
            </div>
          )}
        </div>
      </div>

      {/* =========================================================================
          FEATURE 2: INTERACTIVE HOMEWORK SUBMISSION & AUTOMATED GRADING SECTION
         ========================================================================= */}
      <div
        ref={homeworkSectionRef}
        className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-10 border border-slate-200 dark:border-zinc-800 shadow-md space-y-8"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-zinc-800 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-yellow-500" />
              <h2 className="text-xl sm:text-2xl font-bold font-outfit text-slate-900 dark:text-white">
                {lang === 'ar' ? 'واجب الدرس والتصحيح الآلي' : 'Lesson Homework & Automated Grading'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              {lang === 'ar'
                ? 'أجب على الأسئلة واضغط على زر التسليم لحساب النتيجة وفتح فيديو الدرس تلقائياً'
                : 'Select your answers and click submit to calculate your score and automatically unlock the lesson video.'}
            </p>
          </div>

          {homeworkSubmission && (
            <div className="px-5 py-2.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 font-bold text-sm flex items-center gap-2">
              <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span>
                {t('yourSubmittedScore')}: {homeworkSubmission.score} / {homeworkSubmission.totalQuestions} ({homeworkSubmission.totalQuestions > 0 ? Math.round((homeworkSubmission.score / homeworkSubmission.totalQuestions) * 100) : 0}%)
              </span>
            </div>
          )}
        </div>

        {/* Homework Questions Form */}
        <form onSubmit={handleHomeworkSubmit} className="space-y-8">
          <div className="space-y-6">
            {questionsList.map((q, qIndex) => {
              const qKey = String(q.id || qIndex + 1)
              const selectedOption = userAnswers[qKey]
              const modelAns = lesson.modelAnswers?.[qKey] || q.correctAnswer

              return (
                <div
                  key={qKey}
                  className="space-y-4 p-5 sm:p-6 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800"
                >
                  <div className="font-bold text-base sm:text-lg text-slate-900 dark:text-white flex items-start gap-3">
                    <span className="w-7 h-7 rounded-lg bg-yellow-400 text-black flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 font-mono">
                      {qIndex + 1}
                    </span>
                    <span>{q.question}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ltr:pl-10 rtl:pr-10">
                    {(q.options || ['A) Option A', 'B) Option B', 'C) Option C', 'D) Option D']).map((opt, optIdx) => {
                      const letter = ['A', 'B', 'C', 'D'][optIdx] || String(optIdx + 1)
                      const isSelected = selectedOption === letter || selectedOption === opt

                      let btnStyle = 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-200'

                      // If already submitted, colorize correctly
                      if (homeworkSubmission) {
                        const isCorrectOption = modelAns === letter || modelAns === opt
                        if (isCorrectOption) {
                          btnStyle = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 font-bold'
                        } else if (isSelected && !isCorrectOption) {
                          btnStyle = 'border-red-500 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-300 font-bold'
                        }
                      } else if (isSelected) {
                        btnStyle = 'border-yellow-400 bg-yellow-400/20 text-yellow-800 dark:text-yellow-300 font-bold shadow-sm'
                      }

                      return (
                        <button
                          key={optIdx}
                          type="button"
                          onClick={() => handleOptionSelect(qKey, letter)}
                          className={`p-3.5 rounded-xl border text-sm smooth flex items-center justify-between ${btnStyle} ${lang === 'ar' ? 'text-right' : 'text-left'}`}
                        >
                          <span>{opt}</span>
                          {isSelected && !homeworkSubmission && (
                            <CheckCircle2 className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
                          )}
                          {homeworkSubmission && (modelAns === letter || modelAns === opt) && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          )}
                          {homeworkSubmission && isSelected && !(modelAns === letter || modelAns === opt) && (
                            <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between pt-4 border-t border-slate-200 dark:border-zinc-800">
            <button
              type="submit"
              disabled={isSubmittingHomework}
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-sm shadow-xl transition flex items-center justify-center gap-2"
            >
              {isSubmittingHomework ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{t('submittingHomework')}</span>
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  <span>{homeworkSubmission ? t('retakeHomework') : t('submitHomeworkBtn')}</span>
                </>
              )}
            </button>

            {homeworkSubmission && (
              <button
                type="button"
                onClick={scrollToVideo}
                className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow transition"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>{lang === 'ar' ? 'الانتقال لمشاهدة الفيديو المفتوح 🎬' : 'Watch Unlocked Video 🎬'}</span>
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Discussion */}
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
            <div
              key={c.id}
              className="p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800 space-y-1.5"
            >
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-zinc-300">
                <span>{c.name}</span>
                <span className="text-slate-400 dark:text-zinc-500 font-normal">{c.time}</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-zinc-300">{c.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
