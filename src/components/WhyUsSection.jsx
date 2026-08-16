import { motion } from 'framer-motion'
import { Sparkles, Atom, Zap, Award } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'

export default function WhyUsSection() {
  const { t } = useLanguage()

  const FEATURES = [
    {
      titleKey: 'feat1Title',
      descKey: 'feat1Desc',
      icon: Atom,
      color: 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-yellow-400/30 text-slate-900 dark:text-white',
      iconBox: 'bg-yellow-400/20 text-yellow-700 dark:text-yellow-400 border border-yellow-400/40',
    },
    {
      titleKey: 'feat2Title',
      descKey: 'feat2Desc',
      icon: Zap,
      color: 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-yellow-400/30 text-slate-900 dark:text-white',
      iconBox: 'bg-yellow-400 text-black',
    },
    {
      titleKey: 'feat3Title',
      descKey: 'feat3Desc',
      icon: Award,
      color: 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-yellow-400/30 text-slate-900 dark:text-white',
      iconBox: 'bg-yellow-400/20 text-yellow-700 dark:text-yellow-400 border border-yellow-400/40',
    },
  ]

  return (
    <section className="relative py-20 bg-slate-100/70 dark:bg-black font-ibm overflow-hidden border-t border-slate-200 dark:border-zinc-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-16">
        {/* Header */}
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-yellow-400/20 dark:bg-yellow-400/10 border border-yellow-500/30 text-slate-900 dark:text-yellow-400 text-xs font-bold">
            <Sparkles className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            <span>{t('whyUsBadge')}</span>
          </div>
          <h2 className="font-extrabold text-3xl sm:text-5xl text-slate-900 dark:text-white font-outfit">
            {t('whyUsTitle')}<span className="text-yellow-600 dark:text-yellow-400">{t('brandName')}</span>
          </h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-zinc-400">
            {t('whyUsSubtitle')}
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <motion.div
                key={f.titleKey}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                whileHover={{ y: -6 }}
                className={`relative rounded-3xl p-8 ${f.color} border shadow-lg dark:shadow-2xl overflow-hidden group flex flex-col justify-between min-h-[260px]`}
              >
                {/* Background glow circle */}
                <div className="absolute -top-10 -left-10 w-40 h-40 bg-yellow-400/10 rounded-full blur-2xl group-hover:scale-150 transition duration-500" />

                <div className="relative z-10 space-y-4">
                  <div className={`w-14 h-14 rounded-2xl ${f.iconBox} backdrop-blur-md flex items-center justify-center shadow-md font-bold`}>
                    <Icon className="w-7 h-7" />
                  </div>

                  <h3 className="font-bold text-xl sm:text-2xl font-outfit text-slate-900 dark:text-white">
                    {t(f.titleKey)}
                  </h3>

                  <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed font-ibm">
                    {t(f.descKey)}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
