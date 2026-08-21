import { useState, useEffect, useCallback } from 'react'
import { Award, Plus, Trash2, Loader2, Save, X, ClipboardCheck } from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/catalog'
import {
  fetchQuizzes, createQuiz, deleteQuiz,
  fetchGradesForQuiz, upsertGrade, fetchGroups,
} from '../../lib/api'
import GroupFilterSelect, { getInitialGroupFilter } from './GroupFilterSelect.jsx'

const EMPTY_QUIZ = {
  title: '', description: '', yearId: '5', branch: 'الكهربية والمغناطيسية',
  semester: 1, quizDate: new Date().toISOString().slice(0, 10), maxScore: 100,
}

export default function QuizzesTab({ students }) {
  const { t, lang } = useLanguage()
  const [quizzes, setQuizzes] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_QUIZ)
  const [saving, setSaving] = useState(false)

  const [gradingQuiz, setGradingQuiz] = useState(null)
  const [scores, setScores] = useState({})
  const [loadingGrades, setLoadingGrades] = useState(false)
  const [savingGrades, setSavingGrades] = useState(false)

  // Universal group filter (Feature 3 — shared across all admin modules)
  const [groupId, setGroupId] = useState(() => getInitialGroupFilter())
  const [groups, setGroups] = useState([])
  const selectedGroupName = groups.find((g) => g.id === groupId)?.name || null

  useEffect(() => {
    fetchGroups().then(setGroups).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try { setQuizzes(await fetchQuizzes()) }
    catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createQuiz(form)
      setForm(EMPTY_QUIZ)
      await load()
    } catch (err) { alert(err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm(lang === 'ar' ? 'حذف هذا الاختبار وكل درجاته؟' : 'Delete this quiz and all its grades?')) return
    try { await deleteQuiz(id); await load() }
    catch (err) { alert(err.message) }
  }

  const openGrading = async (quiz) => {
    setGradingQuiz(quiz)
    setLoadingGrades(true)
    try {
      const existing = await fetchGradesForQuiz(quiz.id)
      const map = {}
      existing.forEach((g) => { map[g.student_id] = g.score })
      setScores(map)
    } catch (err) { console.error(err) }
    finally { setLoadingGrades(false) }
  }

  const handleSaveGrades = async () => {
    setSavingGrades(true)
    try {
      const entries = Object.entries(scores).filter(([, v]) => v !== '' && v !== null && v !== undefined)
      for (const [studentId, score] of entries) {
        await upsertGrade({ quizId: gradingQuiz.id, studentId, score })
      }
      setGradingQuiz(null)
    } catch (err) { alert(err.message) }
    finally { setSavingGrades(false) }
  }

  const eligible = gradingQuiz
    ? students.filter((s) => {
        const matchYear = s.year_id === gradingQuiz.year_id
        const matchGroup = !selectedGroupName || (s.group_name || '') === selectedGroupName
        return matchYear && matchGroup
      })
    : []

  return (
    <div className="space-y-6">
      {/* Create quiz */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center gap-2 font-bold text-lg">
          <Plus className="w-5 h-5 text-yellow-500" />
          <span>{t('addQuiz')}</span>
        </div>

        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold mb-1.5">{t('title')}</label>
            <input
              type="text" required value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={lang === 'ar' ? 'اختبار الوحدة الأولى - قانون أوم' : 'Unit 1 Quiz - Ohm\'s Law'}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('gradeLabel')}</label>
            <select
              value={form.yearId} onChange={(e) => setForm({ ...form, yearId: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            >
              {YEARS.map((y) => <option key={y.id} value={y.id}>{lang === 'ar' ? y.titleAr : y.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('date')}</label>
            <input
              type="date" value={form.quizDate}
              onChange={(e) => setForm({ ...form, quizDate: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1.5">{t('maxScore')}</label>
            <input
              type="number" min="1" step="0.5" value={form.maxScore}
              onChange={(e) => setForm({ ...form, maxScore: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit" disabled={saving}
              className="w-full px-6 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-bold text-sm flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>{t('addQuiz')}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Quiz list */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <h3 className="font-bold text-lg">{t('adminQuizzes')}</h3>
        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
        ) : quizzes.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-8">—</p>
        ) : (
          <div className="space-y-2">
            {quizzes.map((q) => (
              <div key={q.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800">
                <div className="min-w-0">
                  <p className="font-bold text-sm">{q.title}</p>
                  <p className="text-xs text-slate-500">
                    {q.quiz_date} · {t('maxScore')}: {q.max_score} ·{' '}
                    {lang === 'ar' ? YEARS.find((y) => y.id === q.year_id)?.titleAr : YEARS.find((y) => y.id === q.year_id)?.title}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openGrading(q)}
                    className="px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-bold flex items-center gap-1.5"
                  >
                    <ClipboardCheck className="w-4 h-4" />
                    <span>{t('enterGrades')}</span>
                  </button>
                  <button
                    onClick={() => handleDelete(q.id)}
                    className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 hover:bg-red-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grade entry modal */}
      {gradingQuiz && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-2xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Award className="w-5 h-5 text-yellow-500" />
                <span>{gradingQuiz.title}</span>
              </h3>
              <div className="flex items-center gap-3">
                {/* Universal group filter (Feature 3) */}
                <div className="w-52">
                  <GroupFilterSelect value={groupId} onChange={setGroupId} groups={groups} compact />
                </div>
                <button onClick={() => setGradingQuiz(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {loadingGrades ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
            ) : eligible.length === 0 ? (
              <p className="text-center text-sm text-slate-500 py-8">—</p>
            ) : (
              <>
                <div className="space-y-2">
                  {eligible.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800">
                      <span className="font-bold text-sm truncate">{s.full_name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="number" min="0" max={gradingQuiz.max_score} step="0.5"
                          value={scores[s.id] ?? ''}
                          onChange={(e) => setScores({ ...scores, [s.id]: e.target.value })}
                          className="w-24 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-center"
                        />
                        <span className="text-xs text-slate-500">/ {gradingQuiz.max_score}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleSaveGrades} disabled={savingGrades}
                  className="w-full px-6 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-bold text-sm flex items-center justify-center gap-2"
                >
                  {savingGrades ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{t('save')}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
