import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { YEARS } from '../data/catalog'
import { ArrowLeft, ArrowRight, GraduationCap } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'

export default function YearsSection() {
  const { lang, t } = useLanguage()
  const [tab, setTab] = useState('all')

  const TABS = [
    { id: 'all', label: lang === 'ar' ? 'جميع الصفوف (2ث & 3ث)' : 'All Grades (2nd & 3rd Sec)' },
    { id: '5', label: lang === 'ar' ? 'تانية ثانوي' : '2nd Secondary' },
    { id: '6', label: lang === 'ar' ? 'ثالثة ثانوي عام' : '3rd Secondary' },
  ]

  const shown = tab === 'all' ? YEARS : YEARS.filter((y) => y.id === tab)
  const ArrowIcon = lang === 'ar' ? ArrowLeft : ArrowRight

  return (
    <section className="space-y-12 py-16 relative bg-slate-50 dark:bg-zinc-950 text-slate-900 dark:text-white" id="courses">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-12">
        {/* Title */}
        <div className="text-center space-y-4 max-w-2xl mx-auto font-ibm">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-yellow-400/20 dark:bg-yellow-400/10 border border-yellow-500/30 text-slate-900 dark:text-yellow-400 text-xs font-bold">
            <GraduationCap className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            <span>{t('yearsBadge')}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white font-outfit">
            {t('yearsTitle')}
          </h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-zinc-400">
            {t('yearsSubtitle')}
          </p>
        </div>

        {/* Tabs Filter */}
        <div className="flex font-ibm justify-center" role="tablist">
          <div className="inline-flex flex-wrap justify-center gap-2 rounded-2xl border border-slate-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 shadow-sm dark:shadow-xl">
            {TABS.map((tItem) => (
              <button
                key={tItem.id}
                role="tab"
                aria-selected={tab === tItem.id}
                onClick={() => setTab(tItem.id)}
                className={`rounded-xl px-6 py-2.5 text-sm md:text-base font-extrabold transition ${
                  tab === tItem.id
                    ? 'bg-yellow-400 text-black shadow-md'
                    : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-yellow-400'
                }`}
              >
                {tItem.label}
              </button>
            ))}
          </div>
        </div>

        {/* Years Cards Grid */}
        <div className="grid font-ibm grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            {shown.map((y) => {
              const cardTitle = lang === 'ar' ? y.titleAr : y.title
              const cardBadge = lang === 'ar' ? y.badgeAr : y.badge
              const cardDesc = lang === 'ar' ? y.descAr : y.desc
              const cardBranches = lang === 'ar' ? y.branchesAr : y.branches

              return (
                <motion.div
                  key={y.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.3 }}
                  whileHover={{ y: -6 }}
                  className="group h-full"
                >
                  <Link to={`/years/${y.id}`} className="block h-full">
                    <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 transition-all duration-300 shadow-lg hover:shadow-2xl hover:border-yellow-500 dark:hover:border-yellow-400/60">
                      <div className="h-2 w-full bg-yellow-400" />

                      <div className="relative overflow-hidden h-44 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-zinc-900 dark:to-black flex items-center justify-center p-6 text-center">
                        <span className="font-extrabold text-2xl sm:text-3xl text-slate-900 dark:text-white group-hover:scale-105 transition duration-300 font-outfit">
                          {cardTitle}
                        </span>

                        <span className="absolute top-4 ltr:left-4 rtl:right-4 rounded-full bg-yellow-400 text-black px-3.5 py-1 text-xs font-extrabold shadow-md">
                          {cardBadge}
                        </span>
                      </div>

                      <div className="flex flex-1 flex-col gap-4 p-6 bg-white dark:bg-zinc-900/90">
                        <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
                          {cardDesc}
                        </p>

                        <div className="flex flex-wrap gap-2 pt-1">
                          {cardBranches.map((b) => (
                            <span
                              key={b}
                              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-yellow-300 border border-slate-200 dark:border-zinc-700"
                            >
                              ⚡ {b}
                            </span>
                          ))}
                        </div>

                        <div className="mt-auto flex items-center justify-between pt-4 border-t border-slate-200 dark:border-zinc-800">
                          <span className="text-sm font-bold text-yellow-600 dark:text-yellow-400 group-hover:underline">
                            {t('exploreLessonsBtn')}
                          </span>

                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-400/20 text-yellow-700 dark:text-yellow-400 group-hover:bg-yellow-400 group-hover:text-black transition">
                            <ArrowIcon className="w-4 h-4" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}
