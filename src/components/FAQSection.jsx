import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HelpCircle, ChevronDown, MessageCircle } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'

export default function FAQSection() {
  const { lang } = useLanguage()
  const [open, setOpen] = useState(0)

  const FAQ = lang === 'ar' ? [
    {
      q: 'إزاي أسجّل في المنصة؟',
      a: 'اضغط على "إنشاء حساب" واملأ بياناتك (الاسم، البريد الإلكتروني، رقم الطالب وولي الأمر، الصف، المحافظة) في دقائق. التسجيل مجاني.',
    },
    {
      q: 'المنصة لطلاب أنهي صفوف؟',
      a: 'المنصة حالياً مخصصة لطلاب المرحلة الثانوية: تانية ثانوي وثالثة ثانوي (ثانوية عامة) في منهج الفيزياء المصري.',
    },
    {
      q: 'إيه نظام فتح فيديوهات شرح الواجب؟',
      a: 'بيتفتح فيديو شرح الواجب تلقائياً بعد ما تسلّم الواجب ويتم تصحيحه (آلياً في أسئلة الاختيار من متعدد أو بواسطة المدرس). عشان نضمن إنك حليت بنفسك الأول.',
    },
    {
      q: 'هل فيه واجبات وتصحيح؟',
      a: 'أيوه. كل درس أو وحدة عليه واجب بأسئلة اختيار من متعدد، بيتم تصحيحه آلياً فور التسليم وبيظهر لك عدد الإجابات الصحيحة والخاطئة والنسبة المئوية.',
    },
    {
      q: 'هل في امتحانات سنوات سابقة؟',
      a: 'نعم، صفحة "امتحانات السنين السابقة" فيها ورق امتحانات المحافظات قابلة للتحميل، وفي فيديوهات حل لبعضها.',
    },
    {
      q: 'أتأخرت في الواجب أو عندي مشكلة في الحساب؟',
      a: 'تواصل مع المدرس مباشرة عبر زر واتساب الموجود في أسفل الشاشة وهنرد عليك في أقرب وقت.',
    },
  ] : [
    {
      q: 'How do I sign up?',
      a: 'Tap "Create Account", fill in your name, email, student/parent phones, grade and governorate — registration is free and takes a couple of minutes.',
    },
    {
      q: 'Which grades is the platform for?',
      a: 'It currently covers the Egyptian secondary physics curriculum for 2nd Secondary and 3rd Secondary (Thanawya Amma).',
    },
    {
      q: 'How does homework-gated video work?',
      a: 'The homework explanation video unlocks automatically after you submit and the work is graded (instantly for MCQ, by the teacher for essays). This guarantees you try first, then watch the explanation.',
    },
    {
      q: 'Is there homework and grading?',
      a: 'Yes. Each lesson/unit has an MCQ homework that is auto-graded on submission, showing correct/incorrect counts and your percentage.',
    },
    {
      q: 'Do you provide past exams?',
      a: 'The Past Exams page hosts downloadable governorate exam papers plus solution videos where available.',
    },
    {
      q: 'I missed a homework or have an account issue — what do I do?',
      a: 'Reach out directly via the WhatsApp button at the bottom of the screen and we\'ll reply as quickly as possible.',
    },
  ]

  return (
    <section className="ph-section bg-slate-50 dark:bg-black text-slate-900 dark:text-white" id="faq">
      <div className="ph-section-inner max-w-4xl">
        <div className="text-center space-y-4">
          <div className="ph-kicker">
            <HelpCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            <span>{lang === 'ar' ? 'الأسئلة الشائعة' : 'Frequently asked questions'}</span>
          </div>
          <h2 className="ph-h2">
            {lang === 'ar' ? 'عندك سؤال؟ ' : 'Got a question? '}
            <span className="text-yellow-600 dark:text-yellow-400">
              {lang === 'ar' ? 'إجاباتك هنا' : 'We have answers'}
            </span>
          </h2>
        </div>

        <div className="space-y-3">
          {FAQ.map((item, i) => {
            const active = open === i
            return (
              <div
                key={i}
                className={`ph-card overflow-hidden transition ${active ? 'border-yellow-400/50 shadow-glow' : ''}`}
              >
                <button
                  onClick={() => setOpen(active ? -1 : i)}
                  className="w-full px-5 sm:px-6 py-4 flex items-center justify-between gap-4 text-start focus:outline-none"
                  aria-expanded={active}
                >
                  <span className="font-bold text-sm sm:text-base flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-yellow-400/20 text-yellow-700 dark:text-yellow-400 flex items-center justify-center text-xs font-extrabold shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {item.q}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 shrink-0 text-yellow-600 dark:text-yellow-400 transition-transform ${active ? 'rotate-180' : ''}`}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {active && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className={`px-5 sm:px-6 pb-5 ${lang === 'ar' ? 'pr-16 sm:pr-20' : 'pl-16 sm:pl-20'} text-sm text-slate-600 dark:text-zinc-400 leading-relaxed`}>
                        {item.a}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>

        <div className="ph-card p-6 sm:p-8 text-center space-y-3 border-yellow-400/40 bg-gradient-to-br from-yellow-400/10 via-transparent to-transparent">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-green-500/20 text-green-600 dark:text-green-400 flex items-center justify-center">
            <MessageCircle className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-lg font-outfit">
            {lang === 'ar' ? 'لسه عندك أسئلة؟' : 'Still have questions?'}
          </h3>
          <p className="text-sm text-slate-600 dark:text-zinc-400 max-w-md mx-auto">
            {lang === 'ar'
              ? 'تواصل مباشرة مع المدرس عبر واتساب في أي وقت.'
              : 'Reach out directly to the teacher any time via WhatsApp.'}
          </p>
          <a
            href="https://wa.me/201091982007"
            target="_blank"
            rel="noreferrer"
            className="ph-btn-primary bg-green-500 hover:bg-green-600 text-white shadow-green-500/20 focus:ring-green-500/30"
          >
            <MessageCircle className="w-4 h-4" />
            <span>{lang === 'ar' ? 'تواصل عبر واتساب' : 'Contact on WhatsApp'}</span>
          </a>
        </div>
      </div>
    </section>
  )
}
