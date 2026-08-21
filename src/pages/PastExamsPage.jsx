import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { FileText, Download, Video, Search, Filter, Sparkles, Loader2 } from 'lucide-react'
import { YEARS, GOVERNORATES } from '../data/catalog'
import { fetchPastExamsFromSupabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n.jsx'

export default function PastExamsPage() {
  const { lang, t } = useLanguage()
  const [selectedYearId, setSelectedYearId] = useState('all')
  const [selectedGov, setSelectedGov] = useState('all')
  const [selectedYearNum, setSelectedYearNum] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [examsList, setExamsList] = useState([])

  useEffect(() => {
    let active = true
    async function loadExams() {
      setLoading(true)
      setLoadError('')
      try {
        const data = await fetchPastExamsFromSupabase()
        if (active) setExamsList(data)
      } catch (_) {
        if (active) setLoadError(lang === 'ar' ? 'تعذر تحميل الامتحانات.' : 'Could not load exams.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadExams()
    return () => { active = false }
  }, [lang])

  const filteredExams = examsList.filter((exam) => {
    const matchGrade = selectedYearId === 'all' || String(exam.yearId) === String(selectedYearId)
    const matchGov = selectedGov === 'all' || exam.governorate === selectedGov
    const matchYearNum = selectedYearNum === 'all' || String(exam.year) === String(selectedYearNum)
    const matchSearch = exam.title.toLowerCase().includes(searchQuery.toLowerCase())
    return matchGrade && matchGov && matchYearNum && matchSearch
  })

  return (
    <div className="min-h-screen py-10 px-4 sm:px-8 max-w-7xl mx-auto space-y-10 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-slate-900 dark:bg-zinc-900 text-white p-8 sm:p-12 shadow-2xl border border-slate-800 dark:border-yellow-400/30"
      >
        <div className="relative z-10 space-y-4 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-yellow-400/20 border border-yellow-400/40 text-xs font-bold text-yellow-300">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            <span>{lang === 'ar' ? 'بنك امتحانات الفيزياء والحلول النموذجية' : 'Physics Past Exams & Solutions Bank'}</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold font-outfit leading-tight">
            {lang === 'ar' ? 'امتحانات السنين السابقة والإجابات النموذجية 📝' : 'Past Governorate Exams & Video Solutions 📝'}
          </h1>

          <p className="text-base sm:text-lg text-slate-300 leading-relaxed">
            {lang === 'ar'
              ? 'تدرب على نماذج امتحانات الفيزياء الحقيقية المرفوعة بـ Supabase مع حلول وافية بالفيديو.'
              : 'Practice real physics past exams with full video walkthroughs and downloadable solution sheets.'}
          </p>
        </div>
      </motion.div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white font-outfit">
            <Filter className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            <span>{lang === 'ar' ? 'تصفية امتحانات الفيزياء:' : 'Filter Physics Exams:'}</span>
          </div>

          <div className="relative w-full md:w-80">
            <input
              type="text"
              placeholder={t('searchExamsPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2.5 ltr:pl-10 rtl:pr-10 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm text-slate-900 dark:text-white"
            />
            <Search className="w-4 h-4 absolute top-3.5 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-zinc-400 mb-1.5">
              {t('filterByGrade')}
            </label>
            <select
              value={selectedYearId}
              onChange={(e) => setSelectedYearId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-bold text-slate-800 dark:text-zinc-200"
            >
              <option value="all">{t('allGrades')}</option>
              {YEARS.map((y) => (
                <option key={y.id} value={y.id}>
                  {lang === 'ar' ? y.titleAr : y.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-zinc-400 mb-1.5">
              {t('filterByGov')}
            </label>
            <select
              value={selectedGov}
              onChange={(e) => setSelectedGov(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-bold text-slate-800 dark:text-zinc-200"
            >
              <option value="all">{t('allGovs')}</option>
              {GOVERNORATES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-zinc-400 mb-1.5">
              {t('filterByYear')}
            </label>
            <select
              value={selectedYearNum}
              onChange={(e) => setSelectedYearNum(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-bold text-slate-800 dark:text-zinc-200"
            >
              <option value="all">{t('allYears')}</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
              <option value="2022">2022</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 font-bold text-yellow-600 dark:text-yellow-400 flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span>{lang === 'ar' ? 'جاري جلب امتحانات الفيزياء...' : 'Loading physics exams...'}</span>
        </div>
      ) : loadError ? (
        <div role="alert" className="p-5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-center font-bold">
          {loadError}
        </div>
      ) : filteredExams.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-3xl border border-dashed border-slate-300 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 space-y-3">
          <FileText className="w-12 h-12 mx-auto text-slate-400 dark:text-zinc-600" />
          <p className="font-bold text-lg">{t('noExamsFound')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredExams.map((exam) => (
            <motion.div
              key={exam.id}
              whileHover={{ y: -3 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 p-6 flex flex-col justify-between shadow-sm hover:shadow-xl transition"
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-400/20 text-yellow-800 dark:text-yellow-300 border border-yellow-400/30">
                    {exam.governorate}
                  </span>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 font-mono">
                    {exam.year}
                  </span>
                </div>

                <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-snug font-outfit">
                  {exam.title}
                </h3>
              </div>

              <div className="pt-6 flex flex-col sm:flex-row items-center gap-3">
                {exam.pdfUrl && (
                  <a
                    href={exam.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full sm:w-1/2 py-3 px-4 rounded-xl border border-yellow-500 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-400/10 text-xs font-bold flex items-center justify-center gap-2 transition"
                  >
                    <Download className="w-4 h-4" />
                    <span>{t('downloadPaper')} ({exam.pdfSize || 'PDF'})</span>
                  </a>
                )}

                {exam.videoSolutionUrl && (
                  <a
                    href={exam.videoSolutionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full sm:w-1/2 py-3 px-4 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-extrabold flex items-center justify-center gap-2 shadow transition"
                  >
                    <Video className="w-4 h-4" />
                    <span>{t('watchSolutionVideo')}</span>
                  </a>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
