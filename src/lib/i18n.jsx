import React, { createContext, useContext, useState, useEffect } from 'react'

const LanguageContext = createContext()

export const translations = {
  en: {
    // General & Brand
    brandName: 'Physics Hub',
    slogan: 'Physics in a Different Way',
    sloganAr: 'physics بطريقه مختلفه',
    teacherTitle: 'Physics Specialist & Educator',
    heroTag: 'The #1 Physics Platform for High School Students',
    heroTitlePrefix: 'Master Physics Smartly with',
    heroTitleHighlight: 'Physics Hub - Eng Taha Elsabagh',
    heroSubtitle1: 'With us, you won\'t just memorize laws and equations... You\'ll learn how to visualize concepts, think scientifically, and solve any problem with confidence.',
    heroSubtitle2: 'Simplified lessons, instant interactive quizzes, and solved past exams with video walkthroughs.',
    startJourney: 'Start Your Journey Now',
    exploreCourses: 'Explore Courses',
    expBadgeTitle: 'Over 3+ Years',
    expBadgeDesc: 'of Physics Teaching Experience',
    platformBadgeTitle: 'Interactive Learning Platform',
    platformBadgeDesc: 'Video Lessons + Quizzes',

    // Navbar
    navHome: 'Home',
    navLessons: 'Lessons',
    navPastExams: 'Past Exams',
    navLogin: 'Log In',
    navRegister: 'Create Account',
    navLogout: 'Log Out',
    navAdmin: 'Admin Dashboard',
    lightMode: 'Light Mode',
    darkMode: 'Dark Mode',
    languageName: 'العربية',
    switchLangLabel: 'Switch to Arabic',

    // Why Us / Features
    whyUsBadge: 'Why Choose Physics Hub?',
    whyUsTitle: 'Why Choose... ',
    whyUsSubtitle: 'Our innovative approach turns physics from a daunting subject into an engaging, visual, and intuitive experience.',
    feat1Title: 'Simplified & Visual Concepting',
    feat1Desc: 'Clear, step-by-step breakdowns of physics laws, forces, and circuits so you understand the core physics without memorizing blindly.',
    feat2Title: 'Continuous Support & Tracking',
    feat2Desc: 'Ongoing progress monitoring and academic support to guide you through challenging problem sets and exam prep.',
    feat3Title: 'Comprehensive Quizzes & Exams',
    feat3Desc: 'Interactive quizzes after every video lesson and real past governorate exams with full step-by-step video solutions.',

    // Years & Stages
    yearsBadge: 'Grades & Academic Stages',
    yearsTitle: 'Select Your Grade & Start Learning ⚡',
    yearsSubtitle: 'Browse specialized physics curricula for your grade level, structured lessons, and solved past exam papers.',
    tabAll: 'All Stages',
    tabPrep: 'Middle School (Prep)',
    tabSec: 'High School (Secondary)',
    exploreLessonsBtn: 'Explore Lessons & Exams',

    // Footer
    footerTag: 'Your Gateway to Excelling in Physics',
    footerDesc: 'A specialized educational platform dedicated to teaching middle and high school Physics using modern interactive techniques.',
    socialHeader: 'Connect with us on social media:',
    ctaHeader: 'Ready to master Physics?',
    ctaButton: 'Register Free Account Now',
    rights: 'All rights reserved © Physics Hub Platform',
    adminLink: '👑 Admin Dashboard',

    // Auth Pages
    loginTitle: 'Welcome Back 👋',
    loginSubtitle: 'Log in to continue your physics lessons and interactive quizzes',
    emailLabel: 'Email Address',
    passwordLabel: 'Password',
    confirmPasswordLabel: 'Confirm Password',
    rememberMe: 'Remember me on this device',
    forgotPassword: 'Forgot Password?',
    loginBtn: 'Log In',
    noAccount: 'Don\'t have an account yet?',
    registerLink: 'Create New Account',
    registerTitle: 'Create Your Account 🎓',
    registerSubtitle: 'Join thousands of students and excel in Physics with Physics Hub',
    fullNameLabel: 'Full Name (Triple or Quadruple)',
    studentPhoneLabel: 'Student Phone (WhatsApp)',
    parentPhoneLabel: 'Parent Phone Number',
    gradeLabel: 'Academic Grade',
    governorateLabel: 'Governorate',
    registerBtn: 'Create Account & Start Now',
    alreadyHaveAccount: 'Already have an account?',

    // Details & Exams
    lessonsTitle: 'Curriculum Lessons',
    examsTitle: 'Past Governorate Exams',
    searchLessonsPlaceholder: 'Search for a lesson...',
    searchExamsPlaceholder: 'Search by governorate or year...',
    noLessonsFound: 'No lessons available for this grade yet.',
    noExamsFound: 'No past exams available for this grade yet.',
    watchLessonBtn: 'Watch Lesson & Exercises',
    downloadPaper: 'Download Paper',
    watchSolutionVideo: 'Watch Video Solution',
    aboutLesson: 'About This Lesson',
    noLessonDesc: 'No additional description available for this lesson.',
    downloadPDFSummary: 'Download Lesson Summary (PDF)',
    quizHeader: 'Test Your Understanding',
    quizResult: 'Score:',
    submitQuiz: 'Submit Quiz 🎯',
    discussionsHeader: 'Student Q&A and Discussions',
    commentPlaceholder: 'Ask a question about this physics lesson...',
    sendComment: 'Send',
    studentTag: 'Student',
    now: 'Just now',
    filterByGrade: 'Grade:',
    filterByGov: 'Governorate:',
    filterByYear: 'Exam Year:',
    allGrades: 'All Grades',
    allGovs: 'All Governorates',
    allYears: 'All Years',
  },
  ar: {
    // General & Brand
    brandName: 'فيزكس هاب',
    slogan: 'physics بطريقه مختلفه',
    sloganAr: 'physics بطريقه مختلفه',
    teacherTitle: 'خبير ومدرس مادة الفيزياء',
    heroTag: 'منصة الفيزياء الأولى للمرحلة الثانوية',
    heroTitlePrefix: 'تعلم الفيزياء بذكاء مع',
    heroTitleHighlight: 'فيزكس هاب - المهندس طه الصباغ',
    heroSubtitle1: 'معانا مش هتحفظ قوانين ومعادلات وبس… هتتعلم إزاي تفهم الفيزياء، تتخيل التجربة، وتحل أي مسألة بثقة في الامتحان.',
    heroSubtitle2: 'شرح مبسط لكل درس، كويزات تفاعلية فورية، وامتحانات سنوات سابقة محلولة بالفيديو.',
    startJourney: 'ابدأ رحلتك الآن',
    exploreCourses: 'استعرض الكورسات',
    expBadgeTitle: 'خبرة أكثر من 3 سنوات',
    expBadgeDesc: 'في تدريس مادة الفيزياء',
    platformBadgeTitle: 'أكبر منصة فيزياء',
    platformBadgeDesc: 'شرح + امتحانات تفاعلية',

    // Navbar
    navHome: 'الرئيسية',
    navLessons: 'الدروس',
    navPastExams: 'امتحانات السنين السابقة',
    navLogin: 'تسجيل الدخول',
    navRegister: 'إنشاء حساب',
    navLogout: 'تسجيل الخروج',
    navAdmin: 'لوحة الأدمن',
    lightMode: 'نهاري',
    darkMode: 'ليلي',
    languageName: 'English',
    switchLangLabel: 'التحويل إلى الإنجليزية',

    // Why Us / Features
    whyUsBadge: 'مميزات المنصة',
    whyUsTitle: 'ليه تختار .. ',
    whyUsSubtitle: 'طريقتنا المبتكرة تضمن تحويل الفيزياء من مادة معقدة إلى تجربة فهم ممتعة وسلسة.',
    feat1Title: 'شرح بسيط وتخيلي',
    feat1Desc: 'شرح واضح ومبسط يساعدك تفهم الفيزياء وقوانينها وتتعامل مع أصعب المسائل بسهولة وثقة دون تعقيد.',
    feat2Title: 'متابعة ودعم مستمر',
    feat2Desc: 'متابعة مستمرة لمستواك ودعم يساعدك تتخطى أي صعوبة وتطور مستواك في الفيزياء خطوة بخطوة معك طوال العام.',
    feat3Title: 'تدريبات وامتحانات شاملة',
    feat3Desc: 'تدريبات متنوعة واختبارات مستمرة مع حلول امتحانات المحافظات تفاعلياً تضمن لك تحقيق الدرجة النهائية.',

    // Years & Stages
    yearsBadge: 'الصفوف والمراحل الدراسية',
    yearsTitle: 'اختر سنتك الدراسية وابدأ التعلم ⚡',
    yearsSubtitle: 'تصفح مناهج الفيزياء المخصصة لصفك الدراسي، الدروس المرتّبة، وااختبارات السنوات السابقة.',
    tabAll: 'كل المراحل',
    tabPrep: 'المرحلة الإعدادية',
    tabSec: 'المرحلة الثانوية',
    exploreLessonsBtn: 'استكشف الدروس والامتحانات',

    // Footer
    footerTag: 'طريقك للتفوق في الفيزياء',
    footerDesc: 'منصة تعليمية متخصصة لشرح منهج الفيزياء للمرحلتين الإعدادية والثانوية بأحدث الوسائل التفاعلية.',
    socialHeader: 'تابعنا على وسائل التواصل الاجتماعي:',
    ctaHeader: 'جاهز تبدأ رحلتك في الفيزياء؟',
    ctaButton: 'سجّل حسابك الآن مجاناً',
    rights: 'جميع الحقوق محفوظة لمنصة فيزكس هاب للفيزياء',
    adminLink: '👑 لوحة الأدمن والتحكم',

    // Auth Pages
    loginTitle: 'مرحباً بك مجدداً 👋',
    loginSubtitle: 'سجّل دخولك لمتابعة دروسك واختباراتك في الفيزياء',
    emailLabel: 'البريد الإلكتروني',
    passwordLabel: 'كلمة المرور',
    confirmPasswordLabel: 'تأكيد كلمة المرور',
    rememberMe: 'تذكرني على هذا الجهاز',
    forgotPassword: 'نسيت كلمة المرور؟',
    loginBtn: 'تسجيل الدخول',
    noAccount: 'ليس لديك حساب بعد؟',
    registerLink: 'إنشاء حساب جديد',
    registerTitle: 'أنشئ حسابك الجديد 🎓',
    registerSubtitle: 'انضم لألاف الطلاب وتفوق في الفيزياء مع فيزكس هاب',
    fullNameLabel: 'الاسم بالكامل (ثلاثي أو رباعي)',
    studentPhoneLabel: 'رقم هاتف الطالب (واتساب)',
    parentPhoneLabel: 'رقم هاتف ولي الأمر',
    gradeLabel: 'السنة الدراسية',
    governorateLabel: 'المحافظة',
    registerBtn: 'إنشاء الحساب والبدء الآن',
    alreadyHaveAccount: 'لديك حساب بالفعل؟',

    // Details & Exams
    lessonsTitle: 'دروس المنهج',
    examsTitle: 'امتحانات المحافظات',
    searchLessonsPlaceholder: 'ابحث عن درس فيزياء...',
    searchExamsPlaceholder: 'ابحث باسم المحافظة أو السنة...',
    noLessonsFound: 'لا توجد دروس مضافة لهذا الصف بعد',
    noExamsFound: 'لا توجد امتحانات سابقة مضافة لهذا الصف بعد',
    watchLessonBtn: 'مشاهدة الدرس والتمارين',
    downloadPaper: 'تحميل الورقة',
    watchSolutionVideo: 'مشاهدة فيديو الحل',
    aboutLesson: 'عن هذا الدرس',
    noLessonDesc: 'لا يوجد وصف إضافي لهذا الدرس.',
    downloadPDFSummary: 'تحميل ملخص الدرس (PDF)',
    quizHeader: 'اختبر فهمك بعد المشاهدة',
    quizResult: 'النتيجة:',
    submitQuiz: 'تأكيد وتقييم النتيجة 🎯',
    discussionsHeader: 'مناقشات وأسئلة الطلاب',
    commentPlaceholder: 'اكتب سؤالك أو استفسارك في الفيزياء...',
    sendComment: 'إرسال',
    studentTag: 'الطالب',
    now: 'الآن',
    filterByGrade: 'الصف الدراسي:',
    filterByGov: 'المحافظة:',
    filterByYear: 'سنة الامتحان:',
    allGrades: 'جميع الصفوف',
    allGovs: 'جميع المحافظات',
    allYears: 'جميع السنوات',
  },
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    if (typeof window === 'undefined') return 'en'
    return localStorage.getItem('app_lang') || 'en'
  })

  useEffect(() => {
    localStorage.setItem('app_lang', lang)
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  const toggleLanguage = () => {
    setLang((prev) => (prev === 'en' ? 'ar' : 'en'))
  }

  const t = (key) => {
    return translations[lang]?.[key] || translations['en']?.[key] || key
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
