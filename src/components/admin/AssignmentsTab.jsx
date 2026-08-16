import { useState, useEffect, useCallback } from 'react'
import { ClipboardList, Plus, Trash2, Loader2, Save, X, Eye, Paperclip } from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/dummyData'
import {
  fetchAssignments, createAssignment, deleteAssignment,
  fetchSubmissionsForAssignment, gradeSubmission,
} from '../../lib/api'

const EMPTY = {
  title: '', description: '', yearId: '5', branch: '',
  dueDate: '', maxScore: 100, attachmentUrl: '', isPublished: true,
}

export default function AssignmentsTab() {
  const { t, lang } = useLanguage()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const [viewing, setViewing] = useState(null)
  const [subs, setSubs] = useState([])
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setItems(await fetchAssignments()) }
    catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createAssignment({ ...form, dueDate: form.dueDate || null })
      setForm(EMPTY)
      await load()
    } catch (err) { alert(err.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm(lang === 'ar' ? 'حذف هذا الواجب وكل تسليماته؟' : 'Delete this assignment and all submissions?')) return
    try { await deleteAssignment(id); await load() }
    catch (err) { alert(err.message) }
  }

  const openSubs = async (a) => {
    setViewing(a)
    setLoadingSubs(true)
    try {
      const rows = await fetchSubmissionsForAssignment(a.id)
      setSubs(rows)
      const d = {}
      rows.forEach((r) => { d[r.id] = { score: r.score ?? '', feedback: r.feedback ?? '' } })
      setDrafts(d)
    } catch (err) { console.error(err) }
    finally { setLoadingSubs(false) }
  }

  const handleGrade = async (submissionId) => {
    setSavingId(submissionId)
    try {
      await gradeSubmission(submissionId, drafts[submissionId])
      await openSubs(viewing)
    } catch (err) { alert(err.message) }
    finally { setSavingId(null) }
  }

  return (
    <div className="space-y-6">
      {/* Create */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center gap-2 font-bold text-lg">
          <Plus className="w-5 h-5 text-yellow-500" />
          <span>{t('addAssignment')}</span>
        </div>

        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold mb-1.5">{t('title')}</label>
            <input
              type="text" required value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold mb-1.5">{t('description')}</label>
            <textarea
              rows={3} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
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
            <label className="block text-xs font-bold mb-1.5">{t('dueDate')}</label>
            <input
              type="datetime-local" value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
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
              <span>{t('addAssignment')}</span>
            </button>
          </div>
        </form>
      </div>

      {/* List */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <h3 className="font-bold text-lg">{t('adminAssignments')}</h3>
        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
        ) : items.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-8">{t('noAssignmentsYet')}</p>
        ) : (
          <div className="space-y-2">
            {items.map((a) => (
              <div key={a.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800">
                <div className="min-w-0">
                  <p className="font-bold text-sm">{a.title}</p>
                  <p className="text-xs text-slate-500">
                    {a.due_date ? new Date(a.due_date).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB') : t('noDueDate')}
                    {' · '}{t('maxScore')}: {a.max_score}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openSubs(a)}
                    className="px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-bold flex items-center gap-1.5"
                  >
                    <Eye className="w-4 h-4" />
                    <span>{t('viewSubmissions')}</span>
                  </button>
                  <button
                    onClick={() => handleDelete(a.id)}
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

      {/* Submissions modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-3xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-yellow-500" />
                <span>{viewing.title}</span>
              </h3>
              <button onClick={() => setViewing(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingSubs ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
            ) : subs.length === 0 ? (
              <p className="text-center text-sm text-slate-500 py-8">—</p>
            ) : (
              <div className="space-y-4">
                {subs.map((s) => (
                  <div key={s.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="font-bold text-sm">{s.profiles?.full_name}</span>
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        s.status === 'graded'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                      }`}>
                        {s.status === 'graded' ? t('graded') : t('submitted')}
                      </span>
                    </div>

                    {s.content && (
                      <p className="text-sm text-slate-700 dark:text-zinc-300 whitespace-pre-wrap bg-white dark:bg-zinc-800 p-3 rounded-xl">
                        {s.content}
                      </p>
                    )}

                    {s.file_url && (
                      <a
                        href={s.file_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-yellow-600 dark:text-yellow-400 hover:underline"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        {t('viewAttachment')}
                      </a>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                      <div>
                        <label className="block text-[11px] font-bold mb-1">{t('score')}</label>
                        <input
                          type="number" min="0" max={viewing.max_score} step="0.5"
                          value={drafts[s.id]?.score ?? ''}
                          onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], score: e.target.value } })}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold mb-1">{t('teacherFeedback')}</label>
                        <input
                          type="text"
                          value={drafts[s.id]?.feedback ?? ''}
                          onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], feedback: e.target.value } })}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
                        />
                      </div>
                      <button
                        onClick={() => handleGrade(s.id)}
                        disabled={savingId === s.id}
                        className="px-4 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-bold text-xs flex items-center justify-center gap-1.5"
                      >
                        {savingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span>{t('save')}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
