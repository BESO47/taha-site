import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { Play, Download, HelpCircle, MessageSquare, Send, Sparkles, Loader2 } from 'lucide-react'
import { fetchLessonByIdFromSupabase, supabase } from '../lib/supabase'
import ProtectedVideoPlayer from '../components/ProtectedVideoPlayer'
import { useLanguage } from '../lib/i18n.jsx'

export default function LessonDetailPage() {
  const { lang, t } = useLanguage()
  const { lessonId } = useParams()
  const [lesson, setLesson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [studentInfo, setStudentInfo] = useState({
    name: lang === 'ar' ? 'طالب المنصة' : 'Physics Student',
    phone: '01xxxxxxxxx',
  })

  // Quiz state
  const [userAnswers, setUserAnswers] = useState({})
  const [isQuizSubmitted, setIsQuizSubmitted] = useState(false)
  const [score, setScore] = useState(0)

  // Comments state
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState('')

  useEffect(() => {
    async function loadLessonAndUser() {
      setLoading(true)
      const data = await fetchLessonByIdFromSupabase(lessonId)
      setLesson(data)

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, phone')
            .eq('id', session.user.id)
            .single()

          if (profile) {
            setStudentInfo({
              name: profile.full_name || session.user.email,
              phone: profile.phone || 'Active Student',
            })
          } else {
            setStudentInfo({
              name: session.user.email || (lang === 'ar' ? 'طالب المنصة' : 'Physics Student'),
              phone: '01xxxxxxxxx',
            })
          }
        }
      } catch (err) {
        console.log('Error fetching user info for watermark:', err)
      }

      setLoading(false)
    }
    loadLessonAndUser()
  }, [lessonId, lang])

  const handleOptionSelect = (qId, optionIdx) => {
    if (isQuizSubmitted) return
    setUserAnswers((prev) => ({ ...prev, [qId]: optionIdx }))
  }

  const handleQuizSubmit = (e) => {
    e.preventDefault()
    if (!lesson?.quiz || lesson.quiz.length === 0) return

    let correctCount = 0
    lesson.quiz.forEach((q) => {
      if (userAnswers[q.id] === q.correctIndex) {
        correctCount += 1
      }
    })

    setScore(correctCount)
    setIsQuizSubmitted(true)

    if (correctCount / lesson.quiz.length >= 0.6) {
      try {
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.7 },
        })
      } catch (err) {
        console.log(err)
      }
    }
  }

  const handleAddComment = (e) => {
    e.preventDefault()
    if (!newComment.trim()) return
    setComments([
      { id: Date.now(), name: `${t('studentTag')}`, time: t('now'), text: newComment },
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

  return (
    <div className="min-h-screen py-8 px-4 sm:px-8 max-w-6xl mx-auto space-y-10 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-400">
        <Link to="/" className="hover:text-yellow-600 dark:hover:text-yellow-400">
          {t('navHome')}
        </Link>
        <span>/</span>
        <span className="text-slate-900 dark:text-white font-bold">{lesson.title}</span>
      </div>

      {/* Main Video Section */}
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-800 dark:text-yellow-300 border border-yellow-400/30">
              ⚡ {lesson.branch || 'Physics'}
            </span>
            <span className="text-xs text-slate-500 dark:text-zinc-400 font-bold">{lesson.unit}</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold font-outfit text-slate-900 dark:text-white">
            {lesson.title}
          </h1>
        </div>

        {/* Video Player */}
        <ProtectedVideoPlayer
          videoUrl={lesson.videoUrl}
          title={lesson.title}
          studentInfo={studentInfo}
        />

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

      {/* Quiz section */}
      {lesson.quiz && lesson.quiz.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-10 border border-slate-200 dark:border-zinc-800 shadow-md space-y-8"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-zinc-800 pb-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                <h2 className="text-xl sm:text-2xl font-bold font-outfit text-slate-900 dark:text-white">
                  {t('quizHeader')}
                </h2>
              </div>
            </div>

            {isQuizSubmitted && (
              <div className="px-5 py-2.5 rounded-2xl bg-yellow-400/20 border border-yellow-400/40 text-yellow-800 dark:text-yellow-300 font-bold text-sm flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-500" />
                <span>{t('quizResult')} {score} / {lesson.quiz.length}</span>
              </div>
            )}
          </div>

          <form onSubmit={handleQuizSubmit} className="space-y-8">
            {lesson.quiz.map((q, qIndex) => (
              <div
                key={q.id || qIndex}
                className="space-y-4 p-5 sm:p-6 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800"
              >
                <div className="font-bold text-base sm:text-lg text-slate-900 dark:text-white flex items-start gap-3">
                  <span className="w-7 h-7 rounded-lg bg-yellow-400 text-black flex items-center justify-center text-xs shrink-0 mt-0.5 font-mono font-extrabold">
                    {qIndex + 1}
                  </span>
                  <span>{q.question}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ltr:pl-10 rtl:pr-10">
                  {q.options.map((opt, optIdx) => {
                    const isThisOptionSelected = userAnswers[q.id || qIndex] === optIdx
                    let btnStyle = 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-200'

                    if (isQuizSubmitted) {
                      if (optIdx === q.correctIndex) {
                        btnStyle = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 font-bold'
                      } else if (isThisOptionSelected) {
                        btnStyle = 'border-red-500 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-300 font-bold'
                      }
                    } else if (isThisOptionSelected) {
                      btnStyle = 'border-yellow-400 bg-yellow-400/20 text-yellow-800 dark:text-yellow-300 font-bold'
                    }

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        disabled={isQuizSubmitted}
                        onClick={() => handleOptionSelect(q.id || qIndex, optIdx)}
                        className={`p-3.5 rounded-xl border text-sm smooth flex items-center justify-between ${btnStyle} ${lang === 'ar' ? 'text-right' : 'text-left'}`}
                      >
                        <span>{opt}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            <button
              type="submit"
              className="px-8 py-3.5 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-sm shadow transition"
            >
              {t('submitQuiz')}
            </button>
          </form>
        </motion.div>
      )}

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
