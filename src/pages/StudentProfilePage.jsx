import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  User, Award, CalendarCheck, ClipboardList, Loader2, TrendingUp,
  CheckCircle2, XCircle, Clock, FileText, Save, Pencil,
} from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { useLanguage } from '../lib/i18n.jsx'
import { YEARS, GOVERNORATES } from '../data/dummyData'
import {
  fetchStudentAnalytics, fetchGradesForStudent, fetchAttendanceForStudent,
  fetchAssignments, fetchSubmissionsForStudent, updateOwnProfile,
} from '../lib/api'
import AssignmentSubmitCard from '../components/AssignmentSubmitCard.jsx'

function StatCard({ icon: Icon, label, value, suffix = '', accent = 'text-yellow-500' }) {
  return (
    <div className="p-6 rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-2">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-zinc-400">
        <Icon className={`w-4 h-4 ${accent}`} />
        <span>{label}</span>
      </div>
      <div className={`text-3xl font-extrabold ${accent} font-outfit`}>
        {value}
        <span className="text-lg">{suffix}</span>
      </div>
    </div>
  )
}

const STATUS_STYLES = {
  present: { icon: CheckCircle2, cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800' },
  absent: { icon: XCircle, cls: 'text-red-600 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' },
  late: { icon: Clock, cls: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' },
  excused: { icon: FileText, cls: 'text-slate-600 bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700' },
}

export default function StudentProfilePage() {
  const { t, lang } = useLanguage()
  const { user, profile, refreshProfile } = useAuth()

  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [analytics, setAnalytics] = useState(null)
  const [grades, setGrades] = useState([])
  const [attendance, setAttendance] = useState([])
  const [assignments, setAssignments] = useState([])
  const [submissions, setSubmissions] = useState([])

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const loadAll = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [a, g, att, asg, subs] = await Promise.all([
        fetchStudentAnalytics(user.id),
        fetchGradesForStudent(user.id),
        fetchAttendanceForStudent(user.id),
        fetchAssignments({ yearId: profile?.year_id }),
        fetchSubmissionsForStudent(user.id),
      ])
      setAnalytics(a)
      setGrades(g)
      setAttendance(att)
      setAssignments(asg)
      setSubmissions(subs)
    } catch (err) {
      console.error('Failed to load profile data:', err)
    } finally {
      setLoading(false)
    }
  }, [user, profile?.year_id])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (profile) {
      setForm({
        fullName: profile.full_name || '',
        phone: profile.phone || '',
        parentPhone: profile.parent_phone || '',
        governorate: profile.governorate || GOVERNORATES[0],
        yearId: profile.year_id || '5',
      })
    }
  }, [profile])

  const handleSaveProfile = async (e) => {
    e.preventDefault()
    setSavingProfile(true)
    try {
      await updateOwnProfile(user.id, form)
      await refreshProfile()
      setEditing(false)
      setSavedMsg(t('saved'))
      setTimeout(() => setSavedMsg(''), 3000)
    } catch (err) {
      console.error(err)
      alert(err.message)
    } finally {
      setSavingProfile(false)
    }
  }

  const submissionFor = (assignmentId) => submissions.find((s) => s.assignment_id === assignmentId)

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3 text-yellow-500 font-bold">
        <Loader2 className="w-10 h-10 animate-spin" />
        <span>{t('loading')}</span>
      </div>
    )
  }

  const TABS = [
    { id: 'overview', label: t('overviewTab'), icon: TrendingUp },
    { id: 'grades', label: t('gradesTab'), icon: Award },
    { id: 'assignments', label: t('assignmentsTab'), icon: ClipboardList },
    { id: 'attendance', label: t('attendanceTab'), icon: CalendarCheck },
  ]

  return (
    <div className="min-h-screen py-10 px-4 sm:px-8 max-w-6xl mx-auto space-y-8 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl bg-slate-900 dark:bg-zinc-900 text-white p-8 shadow-2xl border border-slate-800 dark:border-yellow-400/30 flex flex-col sm:flex-row items-center justify-between gap-6"
      >
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-yellow-400 text-black flex items-center justify-center shrink-0">
            <User className="w-8 h-8" />
          </div>
          <div className="text-center sm:text-start">
            <h1 className="text-2xl sm:text-3xl font-extrabold font-outfit">{profile?.full_name}</h1>
            <p className="text-sm text-slate-300 mt-1">{t('profileSubtitle')}</p>
            <span className="inline-block mt-2 px-3 py-1 rounded-full bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 text-xs font-bold">
              {lang === 'ar'
                ? YEARS.find((y) => y.id === profile?.year_id)?.titleAr
                : YEARS.find((y) => y.id === profile?.year_id)?.title}
            </span>
          </div>
        </div>

        <button
          onClick={() => setEditing((v) => !v)}
          className="px-5 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-sm flex items-center gap-2 transition"
        >
          <Pencil className="w-4 h-4" />
          <span>{t('editProfile')}</span>
        </button>
      </motion.div>

      {savedMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm font-bold text-center">
          {savedMsg}
        </div>
      )}

      {/* Edit profile form */}
      {editing && form && (
        <form
          onSubmit={handleSaveProfile}
          className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-zinc-800 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold mb-1.5">{t('fullNameLabel')}</label>
            <input
              type="text" required value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('studentPhoneLabel')}</label>
            <input
              type="tel" dir="ltr" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('parentPhoneLabel')}</label>
            <input
              type="tel" dir="ltr" value={form.parentPhone}
              onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('gradeLabel')}</label>
            <select
              value={form.yearId}
              onChange={(e) => setForm({ ...form, yearId: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            >
              {YEARS.map((y) => (
                <option key={y.id} value={y.id}>{lang === 'ar' ? y.titleAr : y.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('governorateLabel')}</label>
            <select
              value={form.governorate}
              onChange={(e) => setForm({ ...form, governorate: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            >
              {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 flex gap-3">
            <button
              type="submit" disabled={savingProfile}
              className="px-6 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-bold text-sm flex items-center gap-2"
            >
              {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{t('saveChanges')}</span>
            </button>
            <button
              type="button" onClick={() => setEditing(false)}
              className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
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
                  : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 hover:text-yellow-500'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tb.label}</span>
            </button>
          )
        })}
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <StatCard icon={CalendarCheck} label={t('attendanceRate')} value={analytics?.attendance_percent ?? 0} suffix="%" accent="text-emerald-500" />
          <StatCard icon={Award} label={t('quizAverage')} value={analytics?.avg_quiz_percent ?? 0} suffix="%" accent="text-yellow-500" />
          <StatCard icon={ClipboardList} label={t('assignmentAverage')} value={analytics?.avg_assignment_percent ?? 0} suffix="%" accent="text-purple-500" />
          <StatCard icon={CheckCircle2} label={t('sessionsAttended')} value={`${analytics?.present_count ?? 0}/${analytics?.total_sessions ?? 0}`} accent="text-sky-500" />
          <StatCard icon={Award} label={t('quizzesTaken')} value={analytics?.quiz_count ?? 0} accent="text-amber-500" />
          <StatCard icon={ClipboardList} label={t('submissionsMade')} value={analytics?.submission_count ?? 0} accent="text-indigo-500" />
        </div>
      )}

      {/* GRADES */}
      {tab === 'grades' && (
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm">
          {grades.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-10">{t('noGradesYet')}</p>
          ) : (
            <div className="space-y-3">
              {grades.map((g) => {
                const max = g.quizzes?.max_score || 100
                const percent = Math.round((100 * g.score) / max)
                return (
                  <div key={g.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="font-bold text-sm">{g.quizzes?.title}</span>
                      <span className={`px-3 py-1 rounded-full text-xs font-extrabold ${
                        percent >= 60 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                      : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                      }`}>
                        {g.score} / {max} ({percent}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
                      <div className={`h-full rounded-full ${percent >= 60 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.min(percent, 100)}%` }} />
                    </div>
                    {g.notes && <p className="text-xs text-slate-500">{g.notes}</p>}
                    <p className="text-[11px] text-slate-400 font-mono">{g.quizzes?.quiz_date}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ASSIGNMENTS */}
      {tab === 'assignments' && (
        <div className="space-y-5">
          {assignments.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800">
              <p className="text-center text-sm text-slate-500 py-10">{t('noAssignmentsYet')}</p>
            </div>
          ) : (
            assignments.map((a) => (
              <AssignmentSubmitCard
                key={a.id}
                assignment={a}
                submission={submissionFor(a.id)}
                studentId={user.id}
                onSubmitted={loadAll}
              />
            ))
          )}
        </div>
      )}

      {/* ATTENDANCE */}
      {tab === 'attendance' && (
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm">
          {attendance.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-10">{t('noAttendanceYet')}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {attendance.map((a) => {
                const style = STATUS_STYLES[a.status] || STATUS_STYLES.excused
                const Icon = style.icon
                return (
                  <div key={a.id} className={`p-4 rounded-2xl border flex items-center justify-between gap-3 ${style.cls}`}>
                    <div className="flex items-center gap-2">
                      <Icon className="w-5 h-5" />
                      <span className="font-bold text-sm">{t(a.status)}</span>
                    </div>
                    <span className="text-xs font-mono">{a.session_date}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
