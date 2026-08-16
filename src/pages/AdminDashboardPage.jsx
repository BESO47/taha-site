import { useState, useEffect, useCallback } from 'react'
import {
  Users, BookOpen, FileText, Database, Copy, LogOut, Sparkles,
  Loader2, AlertTriangle, Award, ClipboardList, CalendarCheck, Video,
  MessageCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import { isSupabaseConfigured, SUPABASE_SQL_SCHEMA } from '../lib/supabase'
import { fetchStudents, fetchStudentAnalytics } from '../lib/api'
import { isWebhookConfigured } from '../lib/whatsapp'

import StudentsTab from '../components/admin/StudentsTab.jsx'
import QuizzesTab from '../components/admin/QuizzesTab.jsx'
import AssignmentsTab from '../components/admin/AssignmentsTab.jsx'
import AttendanceTab from '../components/admin/AttendanceTab.jsx'
import VideosTab from '../components/admin/VideosTab.jsx'
import LessonsExamsTab from '../components/admin/LessonsExamsTab.jsx'

export default function AdminDashboardPage() {
  const { t, lang } = useLanguage()
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const [tab, setTab] = useState('overview')
  const [students, setStudents] = useState([])
  const [analytics, setAnalytics] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showSql, setShowSql] = useState(false)
  const [sqlCopied, setSqlCopied] = useState(false)
  const configured = isSupabaseConfigured()

  const loadCore = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [s, a] = await Promise.all([fetchStudents(), fetchStudentAnalytics()])
      setStudents(s)
      setAnalytics(a)
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

  const TABS = [
    { id: 'overview', label: t('adminOverview'), icon: Sparkles },
    { id: 'students', label: `${t('adminStudents')} (${students.length})`, icon: Users },
    { id: 'quizzes', label: t('adminQuizzes'), icon: Award },
    { id: 'assignments', label: t('adminAssignments'), icon: ClipboardList },
    { id: 'attendance', label: t('adminAttendance'), icon: CalendarCheck },
    { id: 'videos', label: t('adminVideos'), icon: Video },
    { id: 'content', label: t('navLessons'), icon: BookOpen },
  ]

  // Aggregate numbers for the overview cards
  const avg = (key) => {
    const vals = analytics.map((a) => Number(a[key]) || 0)
    if (!vals.length) return 0
    return Math.round(vals.reduce((x, y) => x + y, 0) / vals.length)
  }

  return (
    <div className="min-h-screen py-8 px-4 sm:px-8 max-w-7xl mx-auto space-y-8 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-zinc-800 shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-yellow-500 to-yellow-400 text-black flex items-center justify-center text-2xl shadow-lg">
            👑
          </div>
          <div>
            <h1 className="text-2xl font-bold font-outfit">{t('adminTitle')}</h1>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              {profile?.full_name} · Physics Hub
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-center">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center gap-2 text-xs font-bold">
          <Database className="w-4 h-4 text-yellow-500 shrink-0" />
          <span>Supabase:</span>
          {configured ? (
            <span className="px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              {lang === 'ar' ? 'متصل 🟢' : 'Connected 🟢'}
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-md bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
              {lang === 'ar' ? 'غير متصل 🔴' : 'Not connected 🔴'}
            </span>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center gap-2 text-xs font-bold">
          <MessageCircle className="w-4 h-4 text-green-500 shrink-0" />
          <span>WhatsApp:</span>
          <span className="px-2.5 py-0.5 rounded-md bg-slate-200 dark:bg-zinc-800">
            {isWebhookConfigured()
              ? (lang === 'ar' ? 'إرسال تلقائي (Webhook)' : 'Automated (webhook)')
              : (lang === 'ar' ? 'رابط wa.me يدوي' : 'Manual wa.me link')}
          </span>
        </div>
      </div>

      {loadError && (
        <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 flex items-center gap-2 text-xs text-red-700 dark:text-red-300 font-bold">
          <AlertTriangle className="w-4 h-4" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-zinc-800 pb-2">
        {TABS.map((tb) => {
          const Icon = tb.icon
          return (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 ${
                tab === tb.id
                  ? 'bg-yellow-400 text-black shadow'
                  : 'bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 hover:text-yellow-500'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tb.label}</span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
          <span className="text-sm font-bold">{t('loading')}</span>
        </div>
      ) : (
        <>
          {tab === 'overview' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: t('totalStudents'), value: students.length, cls: 'text-yellow-500' },
                { label: t('activeStudents'), value: students.filter((s) => s.is_active).length, cls: 'text-emerald-500' },
                { label: t('attendanceRate'), value: `${avg('attendance_percent')}%`, cls: 'text-sky-500' },
                { label: t('quizAverage'), value: `${avg('avg_quiz_percent')}%`, cls: 'text-purple-500' },
              ].map((c) => (
                <div key={c.label} className="p-6 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-2">
                  <div className="text-xs text-slate-500 font-bold">{c.label}</div>
                  <div className={`text-3xl font-extrabold font-outfit ${c.cls}`}>{c.value}</div>
                </div>
              ))}
            </div>
          )}

          {tab === 'students' && (
            <StudentsTab students={students} analytics={analytics} onRefresh={loadCore} />
          )}
          {tab === 'quizzes' && <QuizzesTab students={students} />}
          {tab === 'assignments' && <AssignmentsTab />}
          {tab === 'attendance' && <AttendanceTab students={students} />}
          {tab === 'videos' && <VideosTab />}
          {tab === 'content' && <LessonsExamsTab />}
        </>
      )}

      {/* SQL modal */}
      {showSql && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-3xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Database className="w-5 h-5 text-yellow-500" />
                <span>Supabase SQL</span>
              </h3>
              <button onClick={() => setShowSql(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
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
                className="absolute top-3 ltr:right-3 rtl:left-3 px-3 py-1.5 rounded-lg bg-yellow-400 text-black text-xs font-bold flex items-center gap-1 hover:bg-yellow-300"
              >
                <Copy className="w-4 h-4" />
                <span>{sqlCopied ? '✅' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
