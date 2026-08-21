import { useState, useEffect, useCallback } from 'react'
import { CalendarCheck, Loader2, Save, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/dummyData'
import { fetchAttendanceByDate, bulkUpsertAttendance, fetchGroups } from '../../lib/api'
import GroupFilterSelect, { getInitialGroupFilter } from './GroupFilterSelect.jsx'

const STATUSES = ['present', 'absent', 'late', 'excused']

const PILL = {
  present: 'bg-emerald-500 text-white',
  absent: 'bg-red-500 text-white',
  late: 'bg-amber-500 text-white',
  excused: 'bg-slate-500 text-white',
}

export default function AttendanceTab({ students }) {
  const { t, lang } = useLanguage()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [yearFilter, setYearFilter] = useState('all')
  const [groupId, setGroupId] = useState(() => getInitialGroupFilter())
  const [groups, setGroups] = useState([])
  const selectedGroupName = groups.find((g) => g.id === groupId)?.name || null
  const [marks, setMarks] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    fetchGroups().then(setGroups).catch(() => {})
  }, [])

  const visible = students.filter((s) => {
    const matchYear = yearFilter === 'all' || s.year_id === yearFilter
    const matchGroup = !selectedGroupName || (s.group_name || '') === selectedGroupName
    return matchYear && matchGroup
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await fetchAttendanceByDate(date)
      const map = {}
      rows.forEach((r) => { map[r.student_id] = r.status })
      setMarks(map)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  const setMark = (studentId, status) =>
    setMarks((prev) => ({ ...prev, [studentId]: prev[studentId] === status ? undefined : status }))

  const markAllPresent = () => {
    const next = { ...marks }
    visible.forEach((s) => { next[s.id] = 'present' })
    setMarks(next)
  }

  const handleSave = async () => {
    const rows = visible
      .filter((s) => marks[s.id])
      .map((s) => ({ studentId: s.id, sessionDate: date, status: marks[s.id], yearId: s.year_id }))

    if (!rows.length) return
    setSaving(true)
    try {
      await bulkUpsertAttendance(rows)
      setSavedMsg(t('saved'))
      setTimeout(() => setSavedMsg(''), 3000)
    } catch (err) {
      console.error(err)
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center gap-2 font-bold text-lg">
          <CalendarCheck className="w-5 h-5 text-yellow-500" />
          <span>{t('adminAttendance')}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('sessionDate')}</label>
            <input
              type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('filterByGrade')}</label>
            <select
              value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            >
              <option value="all">{t('allGrades')}</option>
              {YEARS.map((y) => (
                <option key={y.id} value={y.id}>{lang === 'ar' ? y.titleAr : y.title}</option>
              ))}
            </select>
          </div>
          {/* Universal group filter (Feature 3) */}
          <div>
            <GroupFilterSelect value={groupId} onChange={setGroupId} groups={groups} label={t('filterByGroup')} />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={markAllPresent}
              className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold text-xs flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{t('markAll')}</span>
            </button>
          </div>
        </div>

        {savedMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-sm font-bold text-center">
            {savedMsg}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
        ) : visible.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-10">—</p>
        ) : (
          <>
            <div className="space-y-2">
              {visible.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{s.full_name}</p>
                    <p className="text-[11px] text-slate-500 font-mono" dir="ltr">{s.phone}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {STATUSES.map((st) => (
                      <button
                        key={st}
                        onClick={() => setMark(s.id, st)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                          marks[s.id] === st
                            ? PILL[st]
                            : 'bg-white dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 border border-slate-200 dark:border-zinc-700 hover:border-yellow-400'
                        }`}
                      >
                        {t(st)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleSave} disabled={saving}
              className="px-6 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-bold text-sm flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{t('saveAttendance')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
