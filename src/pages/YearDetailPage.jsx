import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BookOpen, FileText, Play, Download, Search, Sparkles, Loader2 } from 'lucide-react'
import { YEARS } from '../data/dummyData'
import { fetchLessonsFromSupabase, fetchPastExamsFromSupabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n.jsx'

export default function YearDetailPage() {
  const { lang, t } = useLanguage()
  const { yearId } = useParams()
  const yearData = YEARS.find((y) => y.id === (yearId || '5')) || YEARS[0]

  const [activeTab, setActiveTab] = useState('lessons')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const [lessonsList, setLessonsList] = useState([])
  const [examsList, setExamsList] = useState([])

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const [lessons, exams] = await Promise.all([
        fetchLessonsFromSupabase(),
        fetchPastExamsFromSupabase(),
      ])
      setLessonsList(lessons)
      setExamsList(exams)
      setLoading(false)
    }
    loadData()
  }, [yearId])

  const yearTitle = lang === 'ar' ? yearData.titleAr : yearData.title
  const yearBadge = lang === 'ar' ? yearData.badgeAr : yearData.badge
  const yearDesc = lang === 'ar' ? yearData.descAr : yearData.desc

  const yearLessons = lessonsList.filter((l) => String(l.yearId) === String(yearData.id))
  const filteredLessons = yearLessons.filter((l) => {
    return l.title.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const yearExams = examsList.filter((e) => String(e.yearId) === String(yearData.id))
  const filteredExams = yearExams.filter((e) => {
    return e.title.toLowerCase().includes(searchQuery.toLowerCase())
  })

  return (
    <div className="min-h-screen py-10 px-4 sm:px-8 max-w-7xl mx-auto space-y-10 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-400">
        <Link to="/" className="hover:text-yellow-600 dark:hover:text-yellow-400">
          {t('navHome')}
        </Link>
        <span>/</span>
        <span className="text-slate-900 dark:text-white font-bold">{yearTitle}</span>
      </div>

      {/* Hero Header Card */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-slate-900 dark:bg-zinc-900 text-white p-8 sm:p-12 shadow-2xl border border-slate-800 dark:border-yellow-400/30"
      >
        <div className="relative z-10 space-y-6 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 text-xs font-bold">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            <span>{yearBadge}</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold font-outfit leading-tight">
            {yearTitle}
          </h1>

          <p className="text-base sm:text-lg text-slate-300 leading-relaxed">
            {yearDesc}
          </p>

          <div className="flex flex-wrap gap-4 pt-2">
            <div className="px-4 py-2 rounded-xl bg-slate-800 dark:bg-black/60 border border-slate-700 dark:border-zinc-800 text-sm flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-yellow-400" />
              <span>{yearLessons.length} {lang === 'ar' ? 'دروس فيزياء تفاعلية' : 'Physics Lessons'}</span>
            </div>
            <div className="px-4 py-2 rounded-xl bg-slate-800 dark:bg-black/60 border border-slate-700 dark:border-zinc-800 text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-yellow-400" />
              <span>{yearExams.length} {lang === 'ar' ? 'امتحانات سنوات سابقة' : 'Past Exams'}</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Controls Bar */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-200 dark:border-zinc-800 pb-4">
          <div className="flex p-1 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 w-full sm:w-auto shadow-sm">
            <button
              onClick={() => setActiveTab('lessons')}
              className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl font-bold text-sm sm:text-base transition flex items-center justify-center gap-2 ${activeTab === 'lessons'
                ? 'bg-yellow-400 text-black shadow-md'
                : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-yellow-400'
                }`}
            >
              <BookOpen className="w-5 h-5" />
              <span>{t('lessonsTitle')} ({yearLessons.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('exams')}
              className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl font-bold text-sm sm:text-base transition flex items-center justify-center gap-2 ${activeTab === 'exams'
                ? 'bg-yellow-400 text-black shadow-md'
                : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-yellow-400'
                }`}
            >
              <FileText className="w-5 h-5" />
              <span>{t('examsTitle')} ({yearExams.length})</span>
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder={t('searchLessonsPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2.5 ltr:pl-10 rtl:pr-10 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-slate-900 dark:text-white"
            />
            <Search className="w-4 h-4 absolute top-3.5 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 font-bold text-yellow-600 dark:text-yellow-400 flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span>{lang === 'ar' ? 'جاري تحميل دروس الفيزياء...' : 'Loading physics lessons...'}</span>
        </div>
      ) : activeTab === 'lessons' ? (
        <div className="space-y-6">
          {filteredLessons.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-slate-300 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 space-y-3">
              <BookOpen className="w-12 h-12 mx-auto text-slate-400 dark:text-zinc-600" />
              <p className="font-bold text-lg">{t('noLessonsFound')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredLessons.map((lesson) => (
                <motion.div
                  key={lesson.id}
                  whileHover={{ y: -4 }}
                  className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 p-6 flex flex-col justify-between shadow-sm hover:shadow-xl hover:border-yellow-400/50 transition group"
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-800 dark:text-yellow-300 border border-yellow-400/30">
                        ⚡ {lesson.branch || 'Physics'}
                      </span>
                    </div>

                    <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-snug">
                      {lesson.title}
                    </h3>

                    <p className="text-xs text-slate-500 dark:text-zinc-400 line-clamp-2">{lesson.description}</p>
                  </div>

                  <div className="pt-6">
                    <Link
                      to={`/lessons/${lesson.id}`}
                      className="w-full py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow transition"
                    >
                      <Play className="w-4 h-4 fill-black" />
                      <span>{t('watchLessonBtn')}</span>
                    </Link>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {filteredExams.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-slate-300 dark:border-zinc-800 text-slate-500 dark:text-zinc-400">
              <FileText className="w-12 h-12 mx-auto text-slate-400 dark:text-zinc-600 mb-3" />
              <p className="font-bold text-lg">{t('noExamsFound')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredExams.map((exam) => (
                <div
                  key={exam.id}
                  className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 p-6 flex flex-col justify-between shadow-sm"
                >
                  <div className="space-y-3">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-800 dark:text-yellow-300 border border-yellow-400/30">
                      {exam.governorate} ({exam.year})
                    </span>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{exam.title}</h3>
                  </div>

                  <div className="pt-6 flex items-center gap-3">
                    {exam.pdfUrl && (
                      <a
                        href={exam.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="py-2.5 px-4 rounded-xl border border-yellow-500 text-yellow-700 dark:text-yellow-400 text-xs font-bold flex items-center gap-2 hover:bg-yellow-400/10"
                      >
                        <Download className="w-4 h-4" />
                        <span>{t('downloadPaper')}</span>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
