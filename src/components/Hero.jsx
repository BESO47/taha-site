import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight, ArrowLeft, BookOpen, Atom, Zap } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'

export default function Hero() {
  const { lang, t } = useLanguage()

  const ArrowIcon = lang === 'ar' ? ArrowLeft : ArrowRight

  return (
    <section className="min-h-[88vh] relative overflow-hidden flex items-center bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* Ambient background glow */}
      <div className="bg-gradient-to-b from-yellow-500/20 via-amber-500/5 to-transparent h-full w-full absolute inset-0 -z-10" />

      <div className="px-4 sm:px-10 max-w-7xl mx-auto w-full py-12 md:py-20 font-ibm">
        <div className="flex md:flex-row flex-col items-center justify-between gap-12 lg:gap-16">
          {/* Main Copy Column */}
          <motion.div
            initial={{ opacity: 0, x: lang === 'ar' ? 30 : -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className={`md:w-1/2 w-full space-y-6 text-center ${lang === 'ar' ? 'md:text-right' : 'md:text-left'}`}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-400/20 dark:bg-yellow-400/10 border border-yellow-500/40 dark:border-yellow-400/30 text-slate-900 dark:text-yellow-400 text-xs sm:text-sm font-extrabold shadow-sm">
              <Sparkles className="w-4 h-4 text-yellow-600 dark:text-yellow-400 animate-pulse" />
              <span>{t('heroTag')}</span>
            </div>

            <h1 className="font-extrabold text-4xl sm:text-6xl lg:text-7xl text-slate-900 dark:text-white leading-tight font-outfit">
              {t('heroTitlePrefix')}{' '}
              <span className="text-yellow-600 dark:text-yellow-400 block sm:inline">
                {t('heroTitleHighlight')}
              </span>
            </h1>

            {/* Slogan highlight */}
            <div className="inline-block px-4 py-2 rounded-xl bg-yellow-400 text-black font-black text-base sm:text-lg shadow-lg shadow-yellow-400/20 font-outfit tracking-wide">
              ⚡ {t('sloganAr')} — {t('slogan')}
            </div>

            <div className="space-y-3 font-ibm text-base sm:text-lg text-slate-700 dark:text-zinc-300 max-w-2xl leading-relaxed">
              <p>{t('heroSubtitle1')}</p>
              <p className="text-sm sm:text-base text-slate-500 dark:text-zinc-400">
                {t('heroSubtitle2')}
              </p>
            </div>

            {/* CTAs */}
            <div className={`pt-4 flex flex-col sm:flex-row items-center justify-center ${lang === 'ar' ? 'md:justify-end' : 'md:justify-start'} gap-4 font-ibm`}>
              <Link
                to="/register"
                className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-base shadow-xl shadow-yellow-400/25 hover:scale-105 transition flex items-center justify-center gap-2"
              >
                <span>{t('startJourney')}</span>
                <ArrowIcon className="w-5 h-5" />
              </Link>

              <a
                href="#courses"
                className="w-full sm:w-auto px-8 py-4 rounded-2xl border-2 border-slate-300 dark:border-zinc-800 hover:border-yellow-500 text-slate-900 dark:text-zinc-200 font-bold text-base bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 transition flex items-center justify-center gap-2 shadow-sm"
              >
                <BookOpen className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                <span>{t('exploreCourses')}</span>
              </a>
            </div>
          </motion.div>

          {/* Right Column: Hero Graphic Avatar */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="md:w-1/2 w-full flex items-center justify-center relative"
          >
            <div className="relative max-w-md w-full aspect-square">
              {/* Outer glowing physics ring */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-yellow-500 via-amber-400 to-yellow-300 opacity-25 blur-3xl animate-pulse" />

              {/* Main Avatar Card */}
              <div className="relative w-full h-full rounded-full p-3 bg-gradient-to-tr from-slate-200 dark:from-zinc-900 via-yellow-400 to-amber-500 shadow-2xl border border-yellow-400/50">
                <div className="w-full h-full rounded-full overflow-hidden border-4 border-white dark:border-black bg-slate-100 dark:bg-zinc-900">
                  <img
                    src="/MRV1.jpeg"
                    alt="Physics Hub Teacher"
                    className="w-full h-full object-cover object-top hover:scale-105 transition duration-500"
                    draggable="false"
                  />
                </div>
              </div>

              {/* Floating Physics Badge 1 */}
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -top-2 left-1/2 -translate-x-1/2 sm:translate-x-0 ltr:sm:-right-4 ltr:sm:left-auto rtl:sm:-left-4 rtl:sm:right-auto bg-white dark:bg-zinc-900/95 backdrop-blur-md p-3 sm:p-4 rounded-2xl shadow-xl border border-slate-200 dark:border-yellow-400/40 flex items-center gap-3 font-ibm text-slate-900 dark:text-white whitespace-nowrap"
              >
                <div className="w-10 h-10 rounded-xl bg-yellow-400/20 text-yellow-700 dark:text-yellow-400 flex items-center justify-center border border-yellow-400/40">
                  <Atom className="w-6 h-6 animate-spin-slow" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400">{t('expBadgeTitle')}</div>
                  <div className="text-sm font-bold text-slate-900 dark:text-yellow-400">{t('expBadgeDesc')}</div>
                </div>
              </motion.div>

              {/* Floating Physics Badge 2 */}
              <motion.div
                animate={{ y: [0, 10, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
                className="absolute -bottom-2 left-1/2 -translate-x-1/2 sm:translate-x-0 ltr:sm:-left-4 ltr:sm:left-auto rtl:sm:-right-4 rtl:sm:right-auto bg-white dark:bg-zinc-900/95 backdrop-blur-md p-3 sm:p-4 rounded-2xl shadow-xl border border-slate-200 dark:border-yellow-400/40 flex items-center gap-3 font-ibm text-slate-900 dark:text-white whitespace-nowrap"
              >
                <div className="w-10 h-10 rounded-xl bg-yellow-400 text-black flex items-center justify-center font-bold">
                  <Zap className="w-6 h-6 fill-current" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400">{t('platformBadgeTitle')}</div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">{t('platformBadgeDesc')}</div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
