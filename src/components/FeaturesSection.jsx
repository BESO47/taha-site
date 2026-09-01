import { motion } from 'framer-motion'
import {
  Sparkles, Atom, Zap, Award, Video, BarChart3, Lock, ShieldCheck,
} from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'

export default function FeaturesSection() {
  const { t } = useLanguage()

  const FEATURES = [
    {
      titleKey: 'feat1Title',
      descKey: 'feat1Desc',
      icon: Atom,
      highlight: true,
    },
    {
      titleKey: 'feat2Title',
      descKey: 'feat2Desc',
      icon: Lock,
      highlight: false,
    },
    {
      titleKey: 'feat3Title',
      descKey: 'feat3Desc',
      icon: Award,
      highlight: true,
    },
    {
      title: 'feat4Title',
      descKey: null,
      // inline key fallback — uses i18n if provided, else falls back:
      titleAr: 'فيديوهات شرح للواجب',
      titleEn: 'Homework explanation videos',
      descAr: 'بعد التصحيح يتفتح لك فيديو شرح الواجب خطوة بخطوة عشان تعرف أين أخطأت وكيف تفكّر في الحل.',
      descEn: 'After grading, a step-by-step explanation video unlocks so you can see exactly where you went wrong.',
      icon: Video,
    },
    {
      title: 'feat5Title',
      titleAr: 'متابعة تقدمك',
      titleEn: 'Progress tracking',
      descAr: 'صفحتك الشخصية تعرض نسبة الحضور، متوسط الدرجات، والواجبات المسلّمة حتى تتابع مستواك باستمرار.',
      descEn: 'Your personal dashboard shows attendance, average scores, and submissions so you always know your level.',
      icon: BarChart3,
    },
    {
      title: 'feat6Title',
      titleAr: 'محتوى آمن ومرتب',
      titleEn: 'Secure & organized',
      descAr: 'محتوى محمي بقواعد بيانات وسياسات أمان، وكل درس وواجب في مكانه بدون تشتيت.',
      descEn: 'Content is protected by database rules and every lesson/homework has its own clear place.',
      icon: ShieldCheck,
    },
  ]

  return (
    <section className="ph-section bg-white dark:bg-zinc-950 text-slate-900 dark:text-white">
      <div className="ph-section-inner">
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <div className="ph-kicker">
            <Sparkles className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            <span>{t('whyUsBadge')}</span>
          </div>
          <h2 className="ph-h2">
            {t('whyUsTitle')}<span className="text-yellow-600 dark:text-yellow-400">{t('brandName')}</span>
          </h2>
          <p className="ph-muted">{t('whyUsSubtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            const title = f.titleKey
              ? t(f.titleKey)
              : (f.titleAr && f.titleEn ? (document.documentElement.lang === 'ar' ? f.titleAr : f.titleEn) : f.title)
            const desc = f.descKey
              ? t(f.descKey)
              : (document.documentElement.lang === 'ar' ? f.descAr : f.descEn)
            const isMain = i % 3 === 1
            return (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: (i % 3) * 0.1 }}
                whileHover={{ y: -4 }}
                className={`relative rounded-3xl p-7 border overflow-hidden group flex flex-col gap-4 transition
                  ${isMain
                    ? 'bg-gradient-to-br from-yellow-400 to-amber-500 text-black border-yellow-400 shadow-xl shadow-yellow-400/20'
                    : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 shadow-card hover:border-yellow-400/40'
                  }`}
              >
                <div className={`absolute -top-10 -left-10 w-40 h-40 rounded-full blur-2xl transition duration-500 group-hover:scale-150
                  ${isMain ? 'bg-white/20' : 'bg-yellow-400/10'}`}
                />
                <div className="relative z-10 space-y-4">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-md
                    ${isMain
                      ? 'bg-black text-yellow-400'
                      : i % 3 === 0
                        ? 'bg-yellow-400/20 text-yellow-700 dark:text-yellow-400 border border-yellow-400/40'
                        : 'bg-yellow-400 text-black'
                    }`}
                  >
                    <Icon className="w-7 h-7" />
                  </div>
                  <h3 className={`font-bold text-xl font-outfit ${isMain ? 'text-black' : 'text-slate-900 dark:text-white'}`}>
                    {title}
                  </h3>
                  <p className={`text-sm leading-relaxed ${isMain ? 'text-black/80' : 'text-slate-600 dark:text-zinc-400'}`}>
                    {desc}
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
