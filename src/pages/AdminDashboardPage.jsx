import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Users, BookOpen, Database, Copy, LogOut, Sparkles,
  Loader2, AlertTriangle, Award, ClipboardList, CalendarCheck, Video,
  MessageCircle, Plus, TrendingUp, CheckCircle2, UserPlus, FileQuestion,
  FilePlus, Send, Clock3,
} from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import { useLanguage } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import { isSupabaseConfigured, SUPABASE_SQL_SCHEMA } from '../lib/supabase'
import {
  fetchStudents, fetchStudentAnalytics, fetchHomeworkEntries,
  fetchGroups,
} from '../lib/api'

import StudentsTab from '../components/admin/StudentsTab.jsx'
import HomeworkTab from '../components/admin/HomeworkTab.jsx'
import QuizzesTab from '../components/admin/QuizzesTab.jsx'
import AttendanceTab from '../components/admin/AttendanceTab.jsx'
import VideosTab from '../components/admin/VideosTab.jsx'
import LessonsExamsTab from '../components/admin/LessonsExamsTab.jsx'
import BulkMessagingTab from '../components/admin/BulkMessagingTab.jsx'

/** Dashboard overview card */
function KpiCard({ icon: Icon, label, value, sub, accent = 'text-yellow-500', bg = 'bg-yellow-400/15', border = 'border-yellow-400/30' }) {
  return (
    <div className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-2 relative overflow-hidden">
      <div className={`absolute -top-6 ltr:-right-6 rtl:-left-6 w-24 h-24 rounded-full ${bg} blur-2xl opacity-70`} />
      <div className="flex items-center justify-between gap-2 relative">
        <div className="text-xs font-bold text-slate-500 dark:text-zinc-400">{label}</div>
        <div className={`w-9 h-9 rounded-xl ${bg} border ${border} flex items-center justify-center ${accent}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className={`text-3xl font-extrabold font-outfit ${accent} relative`}>{value}</div>
      {sub && <div className="text-[11px] font-bold text-slate-500 dark:text-zinc-400 relative">{sub}</div>}
    </div>
  )
}

export default function AdminDashboardPage() {
  const { t, lang } = useLanguage()
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab] = useState('overview')
  const [students, setStudents] = useState([])
  const [analytics, setAnalytics] = useState([])
  const [homework, setHomework] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showSql, setShowSql] = useState(false)
  const [sqlCopied, setSqlCopied] = useState(false)
  const configured = isSupabaseConfigured()

  const loadCore = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [s, a, h, g] = await Promise.all([
        fetchStudents(),
        fetchStudentAnalytics(),
        fetchHomeworkEntries({ publishedOnly: true }).catch(() => []),
        fetchGroups().catch((err) => { console.error('Failed to load groups:', err); return [] }),
      ])
      setStudents(s)
      setAnalytics(a)
      setHomework(h)
      setGroups(g)
    } catch (err) {
      console.error(err)
      setLoadError(
        lang === 'ar'
          ? 'حدث خطأ أثناء تحميل البيانات من قاعدة البيانات.'
          : 'Failed to load data from the database.'
      )
    } finally {
      setLoading(false)
    }
  }, [lang])

  useEffect(() => { loadCore() }, [loadCore])

  const handleLogout = async () => {
    await signOut()
    navigate('/')
  }

  const copySql = () => {
    navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA)
    setSqlCopied(true)
    setTimeout(() => setSqlCopied(false), 2000)
  }

  // Grouped admin navigation (information architecture)
  const NAV_GROUPS = [
    {
      label: lang === 'ar' ? 'نظرة عامة' : 'Overview',
      items: [{ id: 'overview', label: t('adminOverview'), icon: Sparkles }],
    },
    {
      label: lang === 'ar' ? 'الطلاب' : 'Students',
      items: [{ id: 'students', label: t('adminStudents'), icon: Users }],
    },
    {
      label: lang === 'ar' ? 'المحتوى التعليمي' : 'Learning',
      items: [
        { id: 'content', label: t('navLessons'), icon: BookOpen },
        { id: 'homework', label: t('homeworkModuleTitle'), icon: ClipboardList },
        { id: 'videos', label: t('adminVideos'), icon: Video },
      ],
    },
    {
      label: lang === 'ar' ? 'التقييم والمتابعة' : 'Assessment',
      items: [
        { id: 'quizzes', label: t('adminQuizzes'), icon: Award },
        { id: 'attendance', label: t('adminAttendance'), icon: CalendarCheck },
      ],
    },
    {
      label: lang === 'ar' ? 'التواصل' : 'Communication',
      items: [{ id: 'bulk', label: t('bulkMessaging'), icon: MessageCircle }],
    },
  ]

  const flatTabs = NAV_GROUPS.flatMap((g) => g.items)

  // ---------- Aggregate KPI numbers ----------
  const avg = useMemo(() => {
    const vals = analytics.map((a) => Number(a.attendance_percent) || 0)
    const quizVals = analytics.map((a) => Number(a.avg_quiz_percent) || 0)
    const homeworkVals = analytics.map((a) => Number(a.avg_assignment_percent) || 0)
    const avgOf = (arr) => (arr.length ? Math.round(arr.reduce((x, y) => x + y, 0) / arr.length) : 0)
    return {
      attendance: avgOf(vals),
      quiz: avgOf(quizVals),
      homework: avgOf(homeworkVals),
    }
  }, [analytics])

  const pendingHomework = useMemo(() => {
    // Count students without a graded submission for each active homework entry
    const active = homework.filter((h) => h.isPublished !== false)
    if (!active.length || !students.length) return 0
    // Without pulling every submission here we return a lower bound:
    // total expected submissions = activeCount * enrolledStudents for that grade
    // But to avoid N+1, we simply show published-homework count as proxy when
    // submissions aren't prefetched; actual pending needs submission data.
    return active.length
  }, [homework, students])

  const quickActions = lang === 'ar' ? [
    { id: 'add-student', label: 'إضافة طالب', icon: UserPlus, action: () => setTab('students') },
    { id: 'add-homework', label: 'واجب جديد', icon: FileQuestion, action: () => setTab('homework') },
    { id: 'add-lesson', label: 'إضافة درس', icon: BookOpen, action: () => setTab('content') },
    { id: 'add-quiz', label: 'إضافة اختبار', icon: FilePlus, action: () => setTab('quizzes') },
    { id: 'attendance', label: 'تسجيل الحضور', icon: CalendarCheck, action: () => setTab('attendance') },
    { id: 'whatsapp', label: 'إرسال تقرير واتساب', icon: Send, action: () => setTab('bulk') },
  ] : [
    { id: 'add-student', label: 'Add student', icon: UserPlus, action: () => setTab('students') },
    { id: 'add-homework', label: 'New homework', icon: FileQuestion, action: () => setTab('homework') },
    { id: 'add-lesson', label: 'Add lesson', icon: BookOpen, action: () => setTab('content') },
    { id: 'add-quiz', label: 'New quiz', icon: FilePlus, action: () => setTab('quizzes') },
    { id: 'attendance', label: 'Mark attendance', icon: CalendarCheck, action: () => setTab('attendance') },
    { id: 'whatsapp', label: 'Send WhatsApp report', icon: Send, action: () => setTab('bulk') },
  ]

  return (
    <div className="min-h-screen py-6 sm:py-8 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 sm:p-7 border border-slate-200 dark:border-zinc-800 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-yellow-500 to-yellow-400 text-black flex items-center justify-center text-2xl shadow-lg shrink-0">
            👑
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold font-outfit">{t('adminTitle')}</h1>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              {profile?.full_name} · Physics Hub
              {groups.length ? ` · ${groups.length} ${lang === 'ar' ? 'مجموعة' : 'groups'}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={loadCore}
            className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 text-xs font-bold flex items-center gap-2 transition"
            aria-label={t('refresh')}
          >
            <TrendingUp className="w-4 h-4 text-yellow-500" />
            <span>{t('refresh')}</span>
          </button>
          <button
            onClick={() => setShowSql(true)}
            className="px-4 py-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-xs font-bold flex items-center gap-2 hover:bg-purple-100 transition"
          >
            <Database className="w-4 h-4" />
            <span>Supabase SQL</span>
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 text-xs font-bold flex items-center gap-2 hover:bg-red-100 transition"
          >
            <LogOut className="w-4 h-4" />
            <span>{t('navLogout')}</span>
          </button>
        </div>
      </div>

      {/* Connection banners */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
        <div className="p-4 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center gap-2 text-xs font-bold">
          <Database className="w-4 h-4 text-yellow-500 shrink-0" />
          <span>Supabase:</span>
          {configured ? (
            <span className="px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              {lang === 'ar' ? 'متصل 🟢' : 'Connected 🟢'}
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-md bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
              {lang === 'ar' ? 'غير متصل 🔴 (وضع العرض)' : 'Not connected 🔴 (demo)'}
            </span>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center gap-2 text-xs font-bold">
          <MessageCircle className="w-4 h-4 text-green-500 shrink-0" />
          <span>WhatsApp:</span>
          <span className="px-2.5 py-0.5 rounded-md bg-slate-200 dark:bg-zinc-800">
            {lang === 'ar' ? 'بوابة آمنة' : 'Secure gateway'}
          </span>
        </div>
      </div>

      {loadError && (
        <div className="mt-4 p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 flex items-center gap-2 text-xs text-red-700 dark:text-red-300 font-bold">
          <AlertTriangle className="w-4 h-4" />
          <span>{loadError}</span>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[240px,1fr] gap-6">
        {/* Sidebar navigation (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 ph-card p-3 space-y-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="px-3 pt-1 pb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.items.map((it) => {
                    const Icon = it.icon
                    const active = tab === it.id
                    return (
                      <button
                        key={it.id}
                        onClick={() => setTab(it.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition ${
                          active
                            ? 'bg-yellow-400 text-black shadow'
                            : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="truncate">{it.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Horizontal tab bar (mobile) */}
        <div className="lg:hidden flex flex-nowrap gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
          {flatTabs.map((tb) => {
            const Icon = tb.icon
            return (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`shrink-0 px-4 py-2 rounded-xl font-bold text-xs transition flex items-center gap-1.5 ${
                  tab === tb.id
                    ? 'bg-yellow-400 text-black shadow'
                    : 'bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-zinc-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tb.label}</span>
              </button>
            )
          })}
        </div>

        {/* Main content */}
        <main className="min-w-0 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
              <span className="text-sm font-bold">{t('loading')}</span>
            </div>
          ) : (
            <>
              {tab === 'overview' && (
                <div className="space-y-6">
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                    <KpiCard
                      icon={Users}
                      label={t('totalStudents')}
                      value={students.length}
                      sub={lang === 'ar' ? 'إجمالي الطلاب المسجلين' : 'All registered students'}
                    />
                    <KpiCard
                      icon={CheckCircle2}
                      label={t('activeStudents')}
                      value={students.filter((s) => s.is_active).length}
                      sub={lang === 'ar' ? 'حسابات مفعلة' : 'Active accounts'}
                      accent="text-emerald-500"
                      bg="bg-emerald-500/15"
                      border="border-emerald-500/30"
                    />
                    <KpiCard
                      icon={CalendarCheck}
                      label={t('attendanceRate')}
                      value={`${avg.attendance}%`}
                      sub={lang === 'ar' ? 'متوسط الحضور' : 'Average attendance'}
                      accent="text-sky-500"
                      bg="bg-sky-500/15"
                      border="border-sky-500/30"
                    />
                    <KpiCard
                      icon={Award}
                      label={t('quizAverage')}
                      value={`${avg.quiz}%`}
                      sub={lang === 'ar' ? 'متوسط الاختبارات' : 'Average quiz score'}
                      accent="text-purple-500"
                      bg="bg-purple-500/15"
                      border="border-purple-500/30"
                    />
                    <KpiCard
                      icon={ClipboardList}
                      label={lang === 'ar' ? 'واجبات منشورة' : 'Published homework'}
                      value={pendingHomework}
                      sub={lang === 'ar' ? 'تنتظر التسليم والتصحيح' : 'Awaiting submission / grading'}
                      accent="text-amber-600 dark:text-amber-400"
                      bg="bg-amber-500/15"
                      border="border-amber-500/30"
                    />
                    <KpiCard
                      icon={Clock3}
                      label={lang === 'ar' ? 'مجموعات' : 'Groups'}
                      value={groups.length}
                      sub={lang === 'ar' ? 'مجموعات / سناتر' : 'Groups / centres'}
                      accent="text-pink-500"
                      bg="bg-pink-500/15"
                      border="border-pink-500/30"
                    />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Quick Actions */}
                    <div className="ph-card p-6 lg:col-span-2 space-y-4">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-yellow-500" />
                        <h3 className="font-bold text-lg font-outfit">
                          {lang === 'ar' ? 'إجراءات سريعة' : 'Quick actions'}
                        </h3>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {quickActions.map((qa) => {
                          const Icon = qa.icon
                          return (
                            <button
                              key={qa.id}
                              onClick={qa.action}
                              className="p-4 rounded-2xl bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-zinc-800 hover:border-yellow-400/50 hover:bg-yellow-400/5 transition text-start group"
                            >
                              <div className="w-10 h-10 rounded-xl bg-yellow-400/20 text-yellow-700 dark:text-yellow-400 flex items-center justify-center mb-3 group-hover:bg-yellow-400 group-hover:text-black transition">
                                <Icon className="w-5 h-5" />
                              </div>
                              <div className="text-sm font-bold">{qa.label}</div>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Recent activity / info */}
                    <div className="ph-card p-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-yellow-500" />
                        <h3 className="font-bold text-lg font-outfit">
                          {lang === 'ar' ? 'ملخص سريع' : 'Snapshot'}
                        </h3>
                      </div>

                      {students.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-zinc-400 py-6 text-center">
                          {lang === 'ar'
                            ? 'لا يوجد طلاب بعد. ابدأ بإضافة طلاب أو انتظر التسجيلات.'
                            : 'No students yet. Add some or wait for sign-ups.'}
                        </p>
                      ) : (
                        <ul className="space-y-3">
                          <li className="flex items-center justify-between text-sm">
                            <span className="text-slate-500 font-bold">
                              {lang === 'ar' ? 'تانية ثانوي' : '2nd Secondary'}
                            </span>
                            <span className="font-extrabold text-yellow-600 dark:text-yellow-400">
                              {students.filter((s) => String(s.year_id) === '5').length}
                            </span>
                          </li>
                          <li className="flex items-center justify-between text-sm">
                            <span className="text-slate-500 font-bold">
                              {lang === 'ar' ? 'ثالثة ثانوي' : '3rd Secondary'}
                            </span>
                            <span className="font-extrabold text-yellow-600 dark:text-yellow-400">
                              {students.filter((s) => String(s.year_id) === '6').length}
                            </span>
                          </li>
                          <li className="h-px bg-slate-200 dark:bg-zinc-800" />
                          <li className="flex items-center justify-between text-sm">
                            <span className="text-slate-500 font-bold">
                              {lang === 'ar' ? 'بدون مجموعة' : 'Unassigned'}
                            </span>
                            <span className="font-extrabold text-slate-700 dark:text-zinc-300">
                              {students.filter((s) => !s.group_name).length}
                            </span>
                          </li>
                          <li className="flex items-center justify-between text-sm">
                            <span className="text-slate-500 font-bold">
                              {lang === 'ar' ? 'حسابات غير مفعلة' : 'Inactive accounts'}
                            </span>
                            <span className="font-extrabold text-red-600 dark:text-red-400">
                              {students.filter((s) => s.is_active === false).length}
                            </span>
                          </li>
                        </ul>
                      )}

                      <Link
                        to="/"
                        className="w-full ph-btn-ghost justify-center mt-2"
                      >
                        {lang === 'ar' ? 'عرض الموقع' : 'View public site'}
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'students' && (
                <StudentsTab students={students} analytics={analytics} groups={groups} onRefresh={loadCore} />
              )}
              {tab === 'homework' && <HomeworkTab />}
              {tab === 'quizzes' && <QuizzesTab students={students} />}
              {tab === 'attendance' && <AttendanceTab students={students} />}
              {tab === 'videos' && <VideosTab />}
              {tab === 'content' && <LessonsExamsTab />}
              {tab === 'bulk' && <BulkMessagingTab />}
            </>
          )}
        </main>
      </div>

      {/* SQL modal */}
      {showSql && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-3xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Database className="w-5 h-5 text-yellow-500" />
                <span>Supabase SQL</span>
              </h3>
              <button onClick={() => setShowSql(false)} className="text-slate-400 hover:text-slate-600 text-xl" aria-label="Close">✕</button>
            </div>

            <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
              {lang === 'ar'
                ? 'افتح مشروعك في Supabase ثم SQL Editor وشغّل الكود الكامل الموجود في ملف schema.sql بالمستودع (يشمل الجداول وسياسات RLS). ثم أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env.'
                : 'Open your Supabase project → SQL Editor and run the full script in schema.sql from the repo (tables + RLS policies). Then add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.'}
            </p>

            <div className="relative">
              <pre className="p-4 rounded-xl bg-gray-950 text-emerald-400 font-mono text-xs overflow-x-auto" dir="ltr">
                {SUPABASE_SQL_SCHEMA}
              </pre>
              <button
                onClick={copySql}
                className={`absolute top-3 ${lang === 'ar' ? 'left-3' : 'right-3'} px-3 py-1.5 rounded-lg bg-yellow-400 text-black text-xs font-bold flex items-center gap-1 hover:bg-yellow-300`}
              >
                <Copy className="w-4 h-4" />
                <span>{sqlCopied ? (lang === 'ar' ? 'تم ✅' : 'Copied ✅') : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
