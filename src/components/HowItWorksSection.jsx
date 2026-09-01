import { motion } from 'framer-motion'
import { BookOpen, ClipboardCheck, GraduationCap, Sparkles, PlayCircle } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'

export default function HowItWorksSection() {
  const { t, lang } = useLanguage()

  // Bilingual steps (uses i18n where keys exist; falls back for new copy)
  const STEPS = lang === 'ar' ? [
    {
      num: '01',
      icon: BookOpen,
      title: 'سجّل حسابك مجاناً',
      desc: 'أنشئ حسابك في دقائق واختر صفك الدراسي (تانية أو ثالثة ثانوي) للوصول للمحتوى المناسب لك.',
    },
    {
      num: '02',
      icon: PlayCircle,
      title: 'تابع دروس الشرح',
      desc: 'شاهد دروس الفيديو المنظمة حسب الوحدات، حمّل الملخصات، وتابع تقدمك خطوة بخطوة.',
    },
    {
      num: '03',
      icon: ClipboardCheck,
      title: 'حلّ الواجبات وتسلّمها',
      desc: 'حل واجب كل درس وتسلّمه. التصحيح آلي للاختيار من متعدد، وفيديو شرح الواجب يتفتح فور التصحيح.',
    },
    {
      num: '04',
      icon: GraduationCap,
      title: 'تابع تقدمك ودرجاتك',
      desc: 'صفحتك الشخصية بتعرض درجاتك، حضورك، ونقاط قوتك عشان تعرف دايماً واقف فين.',
    },
  ] : [
    {
      num: '01',
      icon: BookOpen,
      title: 'Create your free account',
      desc: 'Sign up in minutes and choose your grade (2nd or 3rd Secondary) to access the right content for you.',
    },
    {
      num: '02',
      icon: PlayCircle,
      title: 'Watch organized lessons',
      desc: 'Stream structured video lessons by unit, download summaries, and track your progress step by step.',
    },
    {
      num: '03',
      icon: ClipboardCheck,
      title: 'Submit your homework',
      desc: 'Solve and submit each lesson\'s homework. MCQs are graded instantly, and the explanation video unlocks once graded.',
    },
    {
      num: '04',
      icon: GraduationCap,
      title: 'Track your progress',
      desc: 'Your personal dashboard shows grades, attendance, and strengths so you always know where you stand.',
    },
  ]

  return (
    <section className="ph-section bg-slate-50 dark:bg-black text-slate-900 dark:text-white" id="how-it-works">
      <div className="ph-section-inner">
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <div className="ph-kicker">
            <Sparkles className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            <span>{lang === 'ar' ? 'كيف تعمل المنصة' : 'How it works'}</span>
          </div>
          <h2 className="ph-h2">
            {lang === 'ar' ? 'رحلة تعلم منظمة من ' : 'A structured learning journey from '}
            <span className="text-yellow-600 dark:text-yellow-400">
              {lang === 'ar' ? 'أول درس للامتحان' : 'first lesson to exam day'}
            </span>
          </h2>
          <p className="ph-muted">
            {lang === 'ar'
              ? 'المنصة مبنية عشان تضمن لك الفهم قبل الحفظ، والتدريب قبل الامتحان — خطوة بخطوة.'
              : 'Built to make sure you understand before you memorize, and practice before you sit the exam — step by step.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            return (
              <motion.div
                key={s.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.45, delay: i * 0.1 }}
                whileHover={{ y: -4 }}
                className="ph-card p-6 relative overflow-hidden group"
              >
                <div className="absolute -top-4 ltr:-right-4 rtl:-left-4 text-7xl font-black text-yellow-400/10 font-outfit select-none leading-none">
                  {s.num}
                </div>
                <div className="relative z-10 space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-yellow-400 text-black flex items-center justify-center shadow-md">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-lg font-outfit">{s.title}</h3>
                  <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">{s.desc}</p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
