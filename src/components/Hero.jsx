import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight, ArrowLeft, BookOpen, Atom, Zap, PlayCircle } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'

export default function Hero() {
  const { lang, t } = useLanguage()

  const ArrowIcon = lang === 'ar' ? ArrowLeft : ArrowRight

  return (
    <section className="min-h-[90vh] relative overflow-hidden flex items-center bg-slate-50 dark:bg-black text-slate-900 dark:text-white pt-8 pb-16">
      {/* Ambient background glow */}
      <div className="bg-gradient-to-b from-yellow-500/20 via-amber-500/5 to-transparent h-full w-full absolute inset-0 -z-10" />

      <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full font-ibm">
        <div className="flex md:flex-row-reverse flex-col items-center justify-between gap-10 lg:gap-14">
          {/* Right/Left Column: Hero Graphic Avatar */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="md:w-[45%] w-full flex items-center justify-center relative order-first md:order-none"
          >
            <div className="relative max-w-md w-full aspect-square">
              {/* Outer glowing physics ring */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-yellow-500 via-amber-400 to-yellow-300 opacity-25 blur-3xl animate-pulse" />

              {/* Main Avatar Card */}
              <div className="relative w-full h-full rounded-full p-3 bg-gradient-to-tr from-slate-200 dark:from-zinc-900 via-yellow-400 to-amber-500 shadow-2xl border border-yellow-400/50">
                <div className="w-full h-full rounded-full overflow-hidden border-4 border-white dark:border-black bg-slate-100 dark:bg-zinc-900">
                  <img
                    src="/MRV1.jpeg"
                    alt={lang === 'ar' ? 'المهندس طه الصباغ - مدرس الفيزياء' : 'Eng. Taha Elsabagh — Physics Teacher'}
                    className="w-full h-full object-cover object-top"
                    loading="eager"
                    draggable="false"
                  />
                </div>
              </div>

              {/* Floating Badge 1 */}
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className={`absolute -top-2 left-1/2 -translate-x-1/2 sm:translate-x-0
                  ${lang === 'ar'
                    ? 'sm:-left-4 sm:right-auto'
                    : 'sm:-right-4 sm:left-auto'
                  } bg-white dark:bg-zinc-900/95 backdrop-blur-md p-3 sm:p-4 rounded-2xl shadow-xl border border-slate-200 dark:border-yellow-400/40 flex items-center gap-3 font-ibm text-slate-900 dark:text-white whitespace-nowrap z-10`}
              >
                <div className="w-10 h-10 rounded-xl bg-yellow-400/20 text-yellow-700 dark:text-yellow-400 flex items-center justify-center border border-yellow-400/40 shrink-0">
                  <Atom className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-zinc-400">{t('expBadgeTitle')}</div>
                  <div className="text-sm font-bold text-slate-900 dark:text-yellow-400">{t('expBadgeDesc')}</div>
                </div>
              </motion.div>

              {/* Floating Badge 2 */}
              <motion.div
                animate={{ y: [0, 10, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
                className={`absolute -bottom-2 left-1/2 -translate-x-1/2 sm:translate-x-0
                  ${lang === 'ar'
                    ? 'sm:-right-4 sm:left-auto'
                    : 'sm:-left-4 sm:right-auto'
                  } bg-white dark:bg-zinc-900/95 backdrop-blur-md p-3 sm:p-4 rounded-2xl shadow-xl border border-slate-200 dark:border-yellow-400/40 flex items-center gap-3 font-ibm text-slate-900 dark:text-white whitespace-nowrap z-10`}
              >
                <div className="w-10 h-10 rounded-xl bg-yellow-400 text-black flex items-center justify-center font-bold shrink-0">
                  <Zap className="w-6 h-6 fill-current" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 dark:text-zinc-400">{t('platformBadgeTitle')}</div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">{t('platformBadgeDesc')}</div>
                </div>
              </motion.div>
            </div>
          </motion.div>

          {/* Main Copy Column */}
          <motion.div
            initial={{ opacity: 0, x: lang === 'ar' ? 30 : -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className={`md:w-[55%] w-full space-y-5 text-center ${lang === 'ar' ? 'md:text-right' : 'md:text-left'}`}
          >
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-400/20 dark:bg-yellow-400/10 border border-yellow-500/40 dark:border-yellow-400/30 text-slate-900 dark:text-yellow-400 text-xs sm:text-sm font-extrabold shadow-sm`}>
              <Sparkles className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
              <span>{t('heroTag')}</span>
            </div>

            <h1 className="font-extrabold text-[2.25rem] sm:text-5xl lg:text-6xl xl:text-7xl text-slate-900 dark:text-white leading-[1.08] font-outfit">
              {lang === 'ar' ? (
                <>
                  الفيزياء بطريقة مختلفة مع{' '}
                  <span className="text-yellow-600 dark:text-yellow-400 block">
                    أ. طه الصباغ
                  </span>
                </>
              ) : (
                <>
                  Master Physics the smart way with{' '}
                  <span className="text-yellow-600 dark:text-yellow-400 block">
                    Eng. Taha Elsabagh
                  </span>
                </>
              )}
            </h1>

            {/* Identity strip: who + for whom */}
            <div className={`flex flex-wrap items-center gap-2 justify-center ${lang === 'ar' ? 'md:justify-start' : 'md:justify-start'}`}>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-zinc-900 text-white text-xs font-extrabold border border-yellow-400/30">
                <Zap className="w-3.5 h-3.5 text-yellow-400" />
                <span>{lang === 'ar' ? 'مدرس فيزياء' : 'Physics Teacher'}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-yellow-400/10 text-slate-700 dark:text-yellow-300 text-xs font-extrabold border border-yellow-400/30">
                {lang === 'ar' ? 'لطلاب تانية وثالثة ثانوي' : 'For 2nd & 3rd Secondary'}
              </span>
            </div>

            <div className="space-y-3 font-ibm text-base sm:text-lg text-slate-700 dark:text-zinc-300 max-w-2xl leading-relaxed">
              <p>{t('heroSubtitle1')}</p>
              <p className="text-sm sm:text-base text-slate-500 dark:text-zinc-400">
                {t('heroSubtitle2')}
              </p>
            </div>

            {/* CTAs */}
            <div className={`pt-3 flex flex-col sm:flex-row items-center justify-center ${lang === 'ar' ? 'md:justify-start' : 'md:justify-start'} gap-3 font-ibm`}>
              <Link
                to="/register"
                className="w-full sm:w-auto ph-btn-primary text-base px-8 py-4"
              >
                <span>{lang === 'ar' ? 'سجّل وابدأ مجاناً' : 'Create free account'}</span>
                <ArrowIcon className="w-5 h-5" />
              </Link>

              <Link
                to="/lessons"
                className="w-full sm:w-auto ph-btn-secondary text-base px-8 py-4"
              >
                <PlayCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                <span>{lang === 'ar' ? 'استعرض الدروس' : 'Browse lessons'}</span>
              </Link>
            </div>

            {/* Trust row */}
            <div className={`flex flex-wrap items-center justify-center ${lang === 'ar' ? 'md:justify-start' : 'md:justify-start'} gap-x-6 gap-y-2 pt-4 text-xs font-bold text-slate-500 dark:text-zinc-400`}>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                {lang === 'ar' ? 'تسجيل مجاني' : 'Free to sign up'}
              </span>
              <span className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-yellow-500" />
                {lang === 'ar' ? 'دروس منظمة حسب الوحدات' : 'Structured lessons by unit'}
              </span>
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-yellow-500" />
                {lang === 'ar' ? 'تصحيح آلي فوري' : 'Instant auto-grading'}
              </span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
