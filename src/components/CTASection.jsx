import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft, Rocket, Zap } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'

export default function CTASection() {
  const { t, lang } = useLanguage()
  const ArrowIcon = lang === 'ar' ? ArrowLeft : ArrowRight

  return (
    <section className="py-16 sm:py-20 relative overflow-hidden" id="cta">
      <div className="absolute inset-0 bg-gradient-to-br from-yellow-400 via-amber-400 to-yellow-500 dark:from-yellow-500 dark:via-yellow-400 dark:to-amber-500" />
      <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_30%_20%,rgba(0,0,0,0.2),transparent_60%)]" />

      <div className="relative max-w-4xl mx-auto px-4 sm:px-8 text-center space-y-6 text-black">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/15 backdrop-blur text-black text-xs font-extrabold"
        >
          <Zap className="w-4 h-4" />
          <span>{lang === 'ar' ? 'ابدأ رحلتك اليوم' : 'Start your journey today'}</span>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="font-extrabold text-3xl sm:text-5xl lg:text-6xl font-outfit tracking-tight leading-tight"
        >
          {lang === 'ar'
            ? 'جاهز تفهم الفيزياء بجد؟'
            : 'Ready to truly understand physics?'}
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-base sm:text-lg font-bold max-w-2xl mx-auto text-black/80"
        >
          {lang === 'ar'
            ? 'انضم لمنصة فيزكس هاب وابدأ أول درس مجاناً. لا حفظ بلا فهم، ولا فيديوهات مقفولة قبل الواجب، ولا درجات وهمية.'
            : 'Join Physics Hub and start your first lesson for free. No blind memorization, no locked-out videos before homework, no fake grades.'}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2"
        >
          <Link
            to="/register"
            className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-black hover:bg-zinc-900 text-yellow-400 font-extrabold text-base shadow-2xl hover:scale-105 transition flex items-center justify-center gap-2"
          >
            <Rocket className="w-5 h-5" />
            <span>{lang === 'ar' ? 'سجّل حسابك مجاناً' : 'Create your free account'}</span>
            <ArrowIcon className="w-5 h-5" />
          </Link>
          <Link
            to="/lessons"
            className="w-full sm:w-auto px-8 py-4 rounded-2xl border-2 border-black/20 hover:border-black/50 bg-white/20 hover:bg-white/30 backdrop-blur text-black font-bold text-base transition flex items-center justify-center gap-2"
          >
            <span>{lang === 'ar' ? 'استعرض الدروس' : 'Browse lessons'}</span>
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
