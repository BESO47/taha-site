import { useState, useEffect, useCallback } from 'react'
import { Users, Search, Loader2, TrendingUp, X } from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/dummyData'
import { supabase } from '../../lib/supabase'
import {
  fetchStudentAnalytics, fetchGradesForStudent, fetchAttendanceForStudent,
} from '../../lib/api'
import WhatsAppReportButton from '../WhatsAppReportButton.jsx'

function Bar({ value, color = 'bg-yellow-400' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  )
}

export default function StudentsTab({ students, analytics, onRefresh }) {
  const { t, lang } = useLanguage()
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [detail, setDetail] = useState(null)
  const [detailData, setDetailData] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const analyticsFor = useCallback(
    (id) => analytics.find((a) => a.student_id === id) || {},
    [analytics]
  )

  const filtered = students.filter((s) => {
    const q = search.toLowerCase()
    const matchQ = !q || s.full_name?.toLowerCase().includes(q) || (s.phone || '').includes(search)
    const matchY = yearFilter === 'all' || s.year_id === yearFilter
    return matchQ && matchY
  })

  const toggleActive = async (s) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !s.is_active })
        .eq('id', s.id)
      if (error) throw error
      onRefresh?.()
    } catch (err) { alert(err.message) }
  }

  const openDetail = async (s) => {
    setDetail(s)
    setLoadingDetail(true)
    try {
      const [a, g, att] = await Promise.all([
        fetchStudentAnalytics(s.id),
        fetchGradesForStudent(s.id),
        fetchAttendanceForStudent(s.id),
      ])
      setDetailData({ analytics: a || {}, grades: g, attendance: att })
    } catch (err) { console.error(err) }
    finally { setLoadingDetail(false) }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Users className="w-5 h-5 text-yellow-500" />
            <span>{t('adminStudents')} ({filtered.length})</span>
          </h3>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <select
              value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-bold"
            >
              <option value="all">{t('allGrades')}</option>
              {YEARS.map((y) => <option key={y.id} value={y.id}>{lang === 'ar' ? y.titleAr : y.title}</option>)}
            </select>

            <div className="relative w-full sm:w-64">
              <input
                type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === 'ar' ? 'ابحث بالاسم أو الهاتف...' : 'Search name or phone...'}
                className="w-full px-4 py-2.5 ltr:pl-10 rtl:pr-10 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
              />
              <Search className="w-4 h-4 absolute top-3 ltr:left-3.5 rtl:right-3.5 text-slate-400" />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-10">—</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((s) => {
              const a = analyticsFor(s.id)
              return (
                <div key={s.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800 space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <button onClick={() => openDetail(s)} className="font-bold text-sm hover:text-yellow-500 transition text-start">
                        {s.full_name}
                      </button>
                      <p className="text-[11px] text-slate-500 font-mono" dir="ltr">
                        {s.phone} {s.parent_phone ? `· ${s.parent_phone}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        s.is_active
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                      }`}>
                        {s.is_active ? '🟢' : '🔴'}
                      </span>
                      <button
                        onClick={() => toggleActive(s)}
                        className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-bold"
                      >
                        {s.is_active
                          ? (lang === 'ar' ? 'إيقاف' : 'Suspend')
                          : (lang === 'ar' ? 'تفعيل' : 'Activate')}
                      </button>
                      <WhatsAppReportButton student={s} compact />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-[11px]">
                    <div className="space-y-1">
                      <div className="flex justify-between font-bold">
                        <span className="text-slate-500">{t('attendanceRate')}</span>
                        <span>{a.attendance_percent ?? 0}%</span>
                      </div>
                      <Bar value={a.attendance_percent} color="bg-emerald-500" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between font-bold">
                        <span className="text-slate-500">{t('quizAverage')}</span>
                        <span>{a.avg_quiz_percent ?? 0}%</span>
                      </div>
                      <Bar value={a.avg_quiz_percent} color="bg-yellow-400" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between font-bold">
                        <span className="text-slate-500">{t('assignmentAverage')}</span>
                        <span>{a.avg_assignment_percent ?? 0}%</span>
                      </div>
                      <Bar value={a.avg_assignment_percent} color="bg-purple-500" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-2xl w-full space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-yellow-500" />
                <span>{detail.full_name}</span>
              </h3>
              <button onClick={() => { setDetail(null); setDetailData(null) }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingDetail || !detailData ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: t('attendanceRate'), value: `${detailData.analytics.attendance_percent ?? 0}%` },
                    { label: t('quizAverage'), value: `${detailData.analytics.avg_quiz_percent ?? 0}%` },
                    { label: t('assignmentAverage'), value: `${detailData.analytics.avg_assignment_percent ?? 0}%` },
                    { label: t('absent'), value: detailData.analytics.absent_count ?? 0 },
                  ].map((c) => (
                    <div key={c.label} className="p-3 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800 text-center">
                      <p className="text-[10px] text-slate-500 font-bold">{c.label}</p>
                      <p className="text-xl font-extrabold text-yellow-500">{c.value}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <h4 className="font-bold text-sm mb-2">{t('gradesTab')}</h4>
                  {detailData.grades.length === 0 ? (
                    <p className="text-xs text-slate-500">{t('noGradesYet')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detailData.grades.map((g) => (
                        <div key={g.id} className="flex justify-between text-xs p-2.5 rounded-lg bg-slate-50 dark:bg-black/50">
                          <span className="font-bold truncate">{g.quizzes?.title}</span>
                          <span className="font-mono shrink-0">{g.score} / {g.quizzes?.max_score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="font-bold text-sm mb-2">{t('attendanceTab')}</h4>
                  {detailData.attendance.length === 0 ? (
                    <p className="text-xs text-slate-500">{t('noAttendanceYet')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {detailData.attendance.slice(0, 20).map((a) => (
                        <span
                          key={a.id}
                          title={a.session_date}
                          className={`px-2 py-1 rounded-md text-[10px] font-bold ${
                            a.status === 'present' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : a.status === 'absent' ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                            : a.status === 'late' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400'
                          }`}
                        >
                          {a.session_date?.slice(5)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <WhatsAppReportButton student={detail} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
