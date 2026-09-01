import { motion } from 'framer-motion'
import { Award, BookOpen, Users, GraduationCap } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'

export default function TeacherSection() {
  const { t, lang } = useLanguage()

  const name = lang === 'ar' ? 'المهندس طه الصباغ' : 'Eng. Taha Elsabagh'
  const role = lang === 'ar' ? 'مدرس الفيزياء — مؤسس منصة فيزكس هاب' : 'Physics Teacher & Founder of Physics Hub'
  const bioAr = [
    'متخصص في تدريس الفيزياء للمرحلة الثانوية (تانية وثالثة ثانوي)، بأسلوب يعتمد على الفهم والتخيل قبل الحفظ.',
    'يركّز على تبسيط المفاهيم الصعبة، وربط النظرية بالتطبيق، والتدريب المستمر على أنماط الامتحانات.',
    'يقدّم منصة فيزكس هاب لتكون مرجعاً رقمياً متكاملاً للطالب: دروس مرئية، واجبات، تصحيح آلي، وامتحانات محلولة.',
  ]
  const bioEn = [
    'Specialized in teaching physics for Egyptian secondary schools (2nd & 3rd secondary), focused on understanding and visualization before memorization.',
    'Breaks down hard concepts, connects theory to application, and trains students on real exam patterns.',
    'Founded Physics Hub as a complete digital companion: video lessons, homework with automated grading, and solved past exams.',
  ]
  const bio = lang === 'ar' ? bioAr : bioEn

  const STATS = lang === 'ar' ? [
    { icon: BookOpen, value: '3+', label: 'سنوات خبرة في التدريس' },
    { icon: GraduationCap, value: '2', label: 'صفوف ثانوية مغطاة' },
    { icon: Award, value: 'MCQ', label: 'تصحيح آلي فوري' },
  ] : [
    { icon: BookOpen, value: '3+', label: 'years of teaching' },
    { icon: GraduationCap, value: '2', label: 'secondary grades covered' },
    { icon: Award, value: 'MCQ', label: 'instant auto-grading' },
  ]

  return (
    <section className="ph-section bg-slate-100/70 dark:bg-zinc-950 text-slate-900 dark:text-white" id="teacher">
      <div className="ph-section-inner">
        <div className="grid md:grid-cols-2 gap-10 lg:gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: lang === 'ar' ? 30 : -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative mx-auto md:mx-0 max-w-sm w-full aspect-square"
          >
            <div className="absolute inset-0 rounded-[2.5rem] bg-gradient-to-tr from-yellow-500 via-amber-400 to-yellow-300 opacity-25 blur-3xl" />
            <div className="relative w-full h-full rounded-[2rem] p-2 bg-gradient-to-tr from-slate-200 dark:from-zinc-900 via-yellow-400 to-amber-500 shadow-2xl border border-yellow-400/50">
              <div className="w-full h-full rounded-[1.75rem] overflow-hidden border-4 border-white dark:border-black bg-slate-100">
                <img
                  src="/MRV1.jpeg"
                  alt={name}
                  className="w-full h-full object-cover object-top"
                  loading="lazy"
                  draggable="false"
                />
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: lang === 'ar' ? -30 : 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className={`space-y-6 text-center ${lang === 'ar' ? 'md:text-right' : 'md:text-left'}`}
          >
            <div className="ph-kicker mx-auto md:mx-0">
              <Users className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
              <span>{lang === 'ar' ? 'تعرّف على المدرس' : 'Meet your teacher'}</span>
            </div>
            <h2 className="ph-h2">
              {lang === 'ar' ? 'مع ' : 'With '}
              <span className="text-yellow-600 dark:text-yellow-400">{name}</span>
            </h2>
            <p className="text-base sm:text-lg font-bold text-slate-700 dark:text-zinc-300">{role}</p>
            <div className="space-y-3">
              {bio.map((p, i) => (
                <p key={i} className="text-sm sm:text-base text-slate-600 dark:text-zinc-400 leading-relaxed">{p}</p>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 pt-4">
              {STATS.map((s) => {
                const Icon = s.icon
                return (
                  <div key={s.label} className="ph-card p-4 text-center">
                    <div className="w-10 h-10 mx-auto rounded-xl bg-yellow-400/20 text-yellow-700 dark:text-yellow-400 flex items-center justify-center mb-2">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="text-xl font-extrabold font-outfit text-yellow-600 dark:text-yellow-400">{s.value}</div>
                    <div className="text-[11px] font-bold text-slate-500 dark:text-zinc-400 mt-1 leading-tight">{s.label}</div>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
