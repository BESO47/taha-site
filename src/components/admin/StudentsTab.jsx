import { useState, useEffect, useCallback } from 'react'
import { Users, Search, Loader2, TrendingUp, X, Plus, Trash2, Tag, Check, Layers, ClipboardList } from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/dummyData'
import { supabase } from '../../lib/supabase'
import {
  fetchStudentAnalytics, fetchGradesForStudent, fetchAttendanceForStudent,
  fetchGroups, createGroup, deleteGroup, updateStudentGroup,
  fetchHomeworkEntries, fetchSubmissionsForStudent,
} from '../../lib/api'
import WhatsAppReportButton from '../WhatsAppReportButton.jsx'
import GroupFilterSelect, { getInitialGroupFilter } from './GroupFilterSelect.jsx'

function Bar({ value, color = 'bg-yellow-400' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  )
}

export default function StudentsTab({ students = [], analytics = [], onRefresh }) {
  const { t, lang } = useLanguage()
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  // Universal group filter (Feature 3) — shared GroupFilterSelect + ?groupId=
  const [groupId, setGroupId] = useState(() => getInitialGroupFilter())

  // Group Management State
  const [groups, setGroups] = useState([])
  const selectedGroupName = groups?.find((g) => g.id === groupId)?.name || null
  const [showManageGroups, setShowManageGroups] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupYear, setNewGroupYear] = useState('5')
  const [addingGroup, setAddingGroup] = useState(false)
  const [updatingStudentId, setUpdatingStudentId] = useState(null)
  const [successMsg, setSuccessMsg] = useState('')

  // Detail Modal State
  const [detail, setDetail] = useState(null)
  const [detailData, setDetailData] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const loadGroups = useCallback(async () => {
    try {
      const g = await fetchGroups()
      setGroups(g)
    } catch (err) {
      console.warn('Error loading groups:', err)
    }
  }, [])

  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  const analyticsFor = useCallback(
    (id) => analytics.find((a) => a.student_id === id) || {},
    [analytics]
  )

  const filtered = students.filter((s) => {
    const q = search.toLowerCase()
    const matchQ = !q || s.full_name?.toLowerCase().includes(q) || (s.phone || '').includes(search)
    const matchY = yearFilter === 'all' || s.year_id === yearFilter
    const sGroup = s.group_name || s.groupName || ''
    const matchG =
      groupId === 'all' || groupId === null
        ? true
        : groupId === 'none'
        ? !sGroup || sGroup === ''
        : selectedGroupName && sGroup === selectedGroupName

    return matchQ && matchY && matchG
  })

  const toggleActive = async (s) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !s.is_active })
        .eq('id', s.id)
      if (error) throw error
      onRefresh?.()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleGroupChange = async (studentId, newGroupName) => {
    setUpdatingStudentId(studentId)
    try {
      await updateStudentGroup(studentId, newGroupName)
      setSuccessMsg(t('groupUpdatedSuccess'))
      setTimeout(() => setSuccessMsg(''), 3000)
      onRefresh?.()
    } catch (err) {
      alert(err.message)
    } finally {
      setUpdatingStudentId(null)
    }
  }

  const handleAddGroup = async (e) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setAddingGroup(true)
    try {
      await createGroup({ name: newGroupName.trim(), yearId: newGroupYear })
      setNewGroupName('')
      await loadGroups()
    } catch (err) {
      alert(err.message)
    } finally {
      setAddingGroup(false)
    }
  }

  const handleDeleteGroup = async (id) => {
    if (!confirm(lang === 'ar' ? 'حذف هذه المجموعة؟' : 'Delete this group?')) return
    try {
      await deleteGroup(id)
      await loadGroups()
    } catch (err) {
      alert(err.message)
    }
  }

  const openDetail = async (s) => {
    setDetail(s)
    setLoadingDetail(true)
    try {
      const [a, g, att, hw, subs] = await Promise.all([
        fetchStudentAnalytics(s.id),
        fetchGradesForStudent(s.id),
        fetchAttendanceForStudent(s.id),
        fetchHomeworkEntries({ yearId: s.year_id }),
        fetchSubmissionsForStudent(s.id),
      ])
      setDetailData({ analytics: a || {}, grades: g, attendance: att, homeworkEntries: hw, homeworkSubmissions: subs })
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="space-y-6 font-ibm">
      {successMsg && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 text-xs font-bold text-center flex items-center justify-center gap-2">
          <Check className="w-4 h-4 text-emerald-500" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Student Card & Filters */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-yellow-500" />
            <h3 className="font-bold text-lg">
              <span>{t('adminStudents')} ({filtered.length})</span>
            </h3>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowManageGroups(true)}
              className="px-4 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-xs font-bold flex items-center gap-1.5 hover:bg-purple-100 transition"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>{t('manageGroups')} ({groups.length})</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Grade Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">{t('gradeLabel')}</label>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold"
            >
              <option value="all">{t('allGrades')}</option>
              {YEARS.map((y) => (
                <option key={y.id} value={y.id}>
                  {lang === 'ar' ? y.titleAr : y.title}
                </option>
              ))}
            </select>
          </div>

          {/* Universal Group Filter (Feature 3 — shared GroupFilterSelect) */}
          <div>
            <GroupFilterSelect value={groupId} onChange={setGroupId} groups={groups} includeNone />
          </div>

          {/* Name / Phone Search */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">{lang === 'ar' ? 'البحث' : 'Search'}</label>
            <div className="relative w-full">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === 'ar' ? 'ابحث بالاسم أو الهاتف...' : 'Search name or phone...'}
                className="w-full px-4 py-2.5 ltr:pl-10 rtl:pr-10 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs"
              />
              <Search className="w-4 h-4 absolute top-3 ltr:left-3.5 rtl:right-3.5 text-slate-400" />
            </div>
          </div>
        </div>

        {/* Student Cards List */}
        {filtered.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-10">— {t('noStudentsFound')} —</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((s) => {
              const a = analyticsFor(s.id)
              const studentGroup = s.group_name || s.groupName || ''

              return (
                <div
                  key={s.id}
                  className="p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800 space-y-3 hover:border-yellow-400/40 transition"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Student Basic Info */}
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => openDetail(s)}
                          className="font-bold text-sm hover:text-yellow-500 transition text-start"
                        >
                          {s.full_name}
                        </button>
                        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-bold">
                          {lang === 'ar'
                            ? YEARS.find((y) => y.id === s.year_id)?.shortTitleAr
                            : YEARS.find((y) => y.id === s.year_id)?.shortTitle}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono" dir="ltr">
                        {s.phone} {s.parent_phone ? `· ولي الأمر: ${s.parent_phone}` : ''}
                      </p>
                    </div>

                    {/* Group Selector & Student Status Actions */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {/* =========================================================================
                          FEATURE 3: INLINE GROUP DROPDOWN SELECTOR
                         ========================================================================= */}
                      <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-900 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700">
                        <Layers className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                        <span className="text-[10px] font-bold text-slate-400">{t('groupCol')}:</span>
                        <select
                          value={studentGroup}
                          disabled={updatingStudentId === s.id}
                          onChange={(e) => handleGroupChange(s.id, e.target.value)}
                          className="bg-transparent text-xs font-bold text-slate-800 dark:text-zinc-200 focus:outline-none cursor-pointer"
                        >
                          <option value="">{t('noGroupAssigned')}</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.name}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        {updatingStudentId === s.id && <Loader2 className="w-3 h-3 animate-spin text-yellow-500" />}
                      </div>

                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          s.is_active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                        }`}
                      >
                        {s.is_active ? '🟢' : '🔴'}
                      </span>

                      <button
                        onClick={() => toggleActive(s)}
                        className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-bold"
                      >
                        {s.is_active ? (lang === 'ar' ? 'إيقاف' : 'Suspend') : (lang === 'ar' ? 'تفعيل' : 'Activate')}
                      </button>

                      <WhatsAppReportButton student={s} compact />
                    </div>
                  </div>

                  {/* Mini Analytics Bars */}
                  <div className="grid grid-cols-3 gap-3 text-[11px] pt-1">
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

      {/* Group Management Modal */}
      {showManageGroups && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Tag className="w-5 h-5 text-yellow-500" />
                <span>{t('manageGroups')}</span>
              </h3>
              <button
                onClick={() => setShowManageGroups(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Add New Group Form */}
            <form onSubmit={handleAddGroup} className="space-y-3 bg-slate-50 dark:bg-black/50 p-4 rounded-2xl border border-slate-200 dark:border-zinc-800">
              <label className="block text-xs font-bold">{t('addGroup')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={t('groupNamePlaceholder')}
                  className="flex-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                />
                <select
                  value={newGroupYear}
                  onChange={(e) => setNewGroupYear(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                >
                  {YEARS.map((y) => (
                    <option key={y.id} value={y.id}>
                      {lang === 'ar' ? y.shortTitleAr : y.shortTitle}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={addingGroup}
                className="w-full py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 shadow"
              >
                {addingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                <span>{t('saveGroup')}</span>
              </button>
            </form>

            {/* Existing Groups List */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-500">{lang === 'ar' ? 'المجموعات الحالية' : 'Current Groups'}</label>
              {groups.length === 0 ? (
                <p className="text-xs text-slate-400 py-3 text-center">{lang === 'ar' ? 'لا توجد مجموعات مسجلة' : 'No groups created yet'}</p>
              ) : (
                groups.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-black/40 border border-slate-100 dark:border-zinc-800"
                  >
                    <div>
                      <span className="font-bold text-xs">{g.name}</span>
                      <span className="text-[10px] text-slate-400 ms-2">
                        ({lang === 'ar' ? YEARS.find((y) => y.id === g.year_id)?.shortTitleAr : YEARS.find((y) => y.id === g.year_id)?.shortTitle || 'عام'})
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteGroup(g.id)}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Student Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-2xl w-full space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-yellow-500" />
                <span>{detail.full_name}</span>
              </h3>
              <button
                onClick={() => {
                  setDetail(null)
                  setDetailData(null)
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingDetail || !detailData ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-7 h-7 animate-spin text-yellow-500" />
              </div>
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
                            a.status === 'present'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : a.status === 'absent'
                              ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                              : a.status === 'late'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400'
                          }`}
                        >
                          {a.session_date?.slice(5)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Homework History — grades recorded in the Homework module
                    sync automatically into each student's profile */}
                <div>
                  <h4 className="font-bold text-sm mb-2 flex items-center gap-1.5">
                    <ClipboardList className="w-4 h-4 text-yellow-500" />
                    <span>{t('homeworkHistorySection')}</span>
                  </h4>
                  {detailData.homeworkEntries.length === 0 ? (
                    <p className="text-xs text-slate-500">{t('noHomeworkYet')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detailData.homeworkEntries.map((hw) => {
                        const sub = detailData.homeworkSubmissions.find((x) => x.assignment_id === hw.id)
                        const total = hw.totalPoints || hw.maxScore || 0
                        const graded = sub?.status === 'graded' && sub?.score != null
                        return (
                          <div key={hw.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-black/50 text-xs">
                            <div className="min-w-0">
                              <span className="font-bold truncate block">{hw.title}</span>
                              <span className="text-[10px] text-slate-400">
                                {sub ? new Date(sub.submitted_at || sub.graded_at || Date.now()).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : t('notSubmittedShort')}
                              </span>
                            </div>
                            {graded ? (
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-extrabold font-mono shrink-0">
                                {sub.score} / {total}
                              </span>
                            ) : sub ? (
                              <span className="px-2.5 py-1 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 font-bold shrink-0">
                                {t('submitted')}
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400 font-bold shrink-0">
                                {t('notSubmitted')}
                              </span>
                            )}
                          </div>
                        )
                      })}
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
