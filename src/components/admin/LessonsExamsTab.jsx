import { useState, useEffect, useCallback } from 'react'
import { BookOpen, FileText, Plus, Trash2, Pencil, Loader2, Save, X } from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS, GOVERNORATES } from '../../data/dummyData'
import {
  fetchLessonsFromSupabase, createLessonInSupabase,
  updateLessonInSupabase, deleteLessonFromSupabase,
  fetchPastExamsFromSupabase, createPastExamInSupabase,
  updatePastExamInSupabase, deletePastExamFromSupabase,
} from '../../lib/supabase'

const EMPTY_LESSON = {
  title: '', yearId: '5', semester: 1, branch: 'الكهربية والمغناطيسية',
  unit: 'الوحدة الأولى', duration: '45 دقيقة', videoUrl: '',
  isFree: true, summaryPdfName: '', description: '',
}

const EMPTY_EXAM = {
  title: '', yearId: '5', governorate: 'القاهرة', yearNum: '2024',
  semester: 1, branch: 'الكهربية والمغناطيسية', pdfName: '', videoSolutionUrl: '',
}

export default function LessonsExamsTab() {
  const { t, lang } = useLanguage()
  const [sub, setSub] = useState('lessons')

  const [lessons, setLessons] = useState([])
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)

  const [newLesson, setNewLesson] = useState(EMPTY_LESSON)
  const [newExam, setNewExam] = useState(EMPTY_EXAM)
  const [editingLesson, setEditingLesson] = useState(null)
  const [editingExam, setEditingExam] = useState(null)
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [l, e] = await Promise.all([fetchLessonsFromSupabase(), fetchPastExamsFromSupabase()])
      setLessons(l)
      setExams(e)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const yearName = (id) => (lang === 'ar'
    ? YEARS.find((y) => y.id === id)?.titleAr
    : YEARS.find((y) => y.id === id)?.title) || '—'

  // ---- lessons ----
  const addLesson = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await createLessonInSupabase(newLesson); setNewLesson(EMPTY_LESSON); await load() }
    catch (err) { alert(err.message) }
    finally { setBusy(false) }
  }

  const saveLesson = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await updateLessonInSupabase(editingLesson.id, editingLesson); setEditingLesson(null); await load() }
    catch (err) { alert(err.message) }
    finally { setBusy(false) }
  }

  const removeLesson = async (id) => {
    if (!confirm(lang === 'ar' ? 'حذف هذا الدرس؟' : 'Delete this lesson?')) return
    setDeletingId(id)
    try { await deleteLessonFromSupabase(id); await load() }
    catch (err) { alert(err.message) }
    finally { setDeletingId(null) }
  }

  // ---- exams ----
  const addExam = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await createPastExamInSupabase(newExam); setNewExam(EMPTY_EXAM); await load() }
    catch (err) { alert(err.message) }
    finally { setBusy(false) }
  }

  const saveExam = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await updatePastExamInSupabase(editingExam.id, editingExam); setEditingExam(null); await load() }
    catch (err) { alert(err.message) }
    finally { setBusy(false) }
  }

  const removeExam = async (id) => {
    if (!confirm(lang === 'ar' ? 'حذف هذا الامتحان؟' : 'Delete this exam?')) return
    setDeletingId(id)
    try { await deletePastExamFromSupabase(id); await load() }
    catch (err) { alert(err.message) }
    finally { setDeletingId(null) }
  }

  const inputCls = 'w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm'

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <button
          onClick={() => setSub('lessons')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 ${
            sub === 'lessons' ? 'bg-yellow-400 text-black' : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>{t('lessonsTitle')} ({lessons.length})</span>
        </button>
        <button
          onClick={() => setSub('exams')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 ${
            sub === 'exams' ? 'bg-yellow-400 text-black' : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>{t('examsTitle')} ({exams.length})</span>
        </button>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-yellow-500" /></div>
      ) : sub === 'lessons' ? (
        <>
          <form onSubmit={addLesson} className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 flex items-center gap-2 font-bold text-lg">
              <Plus className="w-5 h-5 text-yellow-500" />
              <span>{lang === 'ar' ? 'إضافة درس جديد' : 'Add a lesson'}</span>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold mb-1.5">{t('title')}</label>
              <input
                type="text" required value={newLesson.title}
                onChange={(e) => setNewLesson({ ...newLesson, title: e.target.value })}
                placeholder={lang === 'ar' ? 'درس (1) قانون أوم والمقاومة الكهربية' : 'Lesson 1: Ohm\'s Law'}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">{t('gradeLabel')}</label>
              <select value={newLesson.yearId} onChange={(e) => setNewLesson({ ...newLesson, yearId: e.target.value })} className={inputCls}>
                {YEARS.map((y) => <option key={y.id} value={y.id}>{yearName(y.id)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">{lang === 'ar' ? 'الفرع' : 'Branch'}</label>
              <input
                type="text" required value={newLesson.branch}
                onChange={(e) => setNewLesson({ ...newLesson, branch: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold mb-1.5">
                {lang === 'ar' ? 'رابط الفيديو (Drive / YouTube / MP4)' : 'Video URL (Drive / YouTube / MP4)'}
              </label>
              <input
                type="url" required dir="ltr" value={newLesson.videoUrl}
                onChange={(e) => setNewLesson({ ...newLesson, videoUrl: e.target.value })}
                className={`${inputCls} font-mono`}
              />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={busy} className="px-6 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-bold text-sm flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                <span>{t('save')}</span>
              </button>
            </div>
          </form>

          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-2">
            {lessons.length === 0 ? (
              <p className="text-center text-xs text-slate-500 py-8">{t('noLessonsFound')}</p>
            ) : lessons.map((l) => (
              <div key={l.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800">
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{l.title}</p>
                  <p className="text-[11px] text-slate-500">{yearName(l.yearId)} · {l.branch}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setEditingLesson({ ...l })} className="p-1.5 rounded-lg bg-yellow-50 dark:bg-yellow-950/40 text-yellow-600">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => removeLesson(l.id)} disabled={deletingId === l.id} className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600">
                    {deletingId === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <form onSubmit={addExam} className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 flex items-center gap-2 font-bold text-lg">
              <Plus className="w-5 h-5 text-amber-500" />
              <span>{lang === 'ar' ? 'إضافة امتحان محافظة' : 'Add a past exam'}</span>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold mb-1.5">{t('title')}</label>
              <input
                type="text" required value={newExam.title}
                onChange={(e) => setNewExam({ ...newExam, title: e.target.value })}
                placeholder={lang === 'ar' ? 'امتحان محافظة القاهرة 2024 - فيزياء' : 'Cairo 2024 Physics Exam'}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">{t('gradeLabel')}</label>
              <select value={newExam.yearId} onChange={(e) => setNewExam({ ...newExam, yearId: e.target.value })} className={inputCls}>
                {YEARS.map((y) => <option key={y.id} value={y.id}>{yearName(y.id)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">{t('governorateLabel')}</label>
              <select value={newExam.governorate} onChange={(e) => setNewExam({ ...newExam, governorate: e.target.value })} className={inputCls}>
                {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">{t('filterByYear')}</label>
              <input type="text" value={newExam.yearNum} onChange={(e) => setNewExam({ ...newExam, yearNum: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">{lang === 'ar' ? 'رابط فيديو الحل' : 'Solution video URL'}</label>
              <input type="url" dir="ltr" value={newExam.videoSolutionUrl} onChange={(e) => setNewExam({ ...newExam, videoSolutionUrl: e.target.value })} className={`${inputCls} font-mono`} />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={busy} className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold text-sm flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                <span>{t('save')}</span>
              </button>
            </div>
          </form>

          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-2">
            {exams.length === 0 ? (
              <p className="text-center text-xs text-slate-500 py-8">{t('noExamsFound')}</p>
            ) : exams.map((ex) => (
              <div key={ex.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800">
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{ex.title}</p>
                  <p className="text-[11px] text-slate-500">{ex.governorate} · {ex.year}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setEditingExam({ ...ex, yearNum: ex.year })} className="p-1.5 rounded-lg bg-yellow-50 dark:bg-yellow-950/40 text-yellow-600">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => removeExam(ex.id)} disabled={deletingId === ex.id} className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600">
                    {deletingId === ex.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Edit lesson modal */}
      {editingLesson && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveLesson} className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-2xl w-full space-y-4 max-h-[85vh] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 flex items-center justify-between">
              <h3 className="font-bold text-lg">{t('edit')}</h3>
              <button type="button" onClick={() => setEditingLesson(null)} className="text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold mb-1.5">{t('title')}</label>
              <input type="text" required value={editingLesson.title} onChange={(e) => setEditingLesson({ ...editingLesson, title: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">{t('gradeLabel')}</label>
              <select value={editingLesson.yearId} onChange={(e) => setEditingLesson({ ...editingLesson, yearId: e.target.value })} className={inputCls}>
                {YEARS.map((y) => <option key={y.id} value={y.id}>{yearName(y.id)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">{lang === 'ar' ? 'الفرع' : 'Branch'}</label>
              <input type="text" required value={editingLesson.branch} onChange={(e) => setEditingLesson({ ...editingLesson, branch: e.target.value })} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold mb-1.5">Video URL</label>
              <input type="url" required dir="ltr" value={editingLesson.videoUrl} onChange={(e) => setEditingLesson({ ...editingLesson, videoUrl: e.target.value })} className={`${inputCls} font-mono`} />
            </div>
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={busy} className="flex-1 px-6 py-3 rounded-xl bg-yellow-400 text-black font-bold text-sm flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{t('saveChanges')}</span>
              </button>
              <button type="button" onClick={() => setEditingLesson(null)} className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm">{t('cancel')}</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit exam modal */}
      {editingExam && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveExam} className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-2xl w-full space-y-4 max-h-[85vh] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 flex items-center justify-between">
              <h3 className="font-bold text-lg">{t('edit')}</h3>
              <button type="button" onClick={() => setEditingExam(null)} className="text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold mb-1.5">{t('title')}</label>
              <input type="text" required value={editingExam.title} onChange={(e) => setEditingExam({ ...editingExam, title: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">{t('governorateLabel')}</label>
              <select value={editingExam.governorate} onChange={(e) => setEditingExam({ ...editingExam, governorate: e.target.value })} className={inputCls}>
                {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5">{t('filterByYear')}</label>
              <input type="text" value={editingExam.yearNum} onChange={(e) => setEditingExam({ ...editingExam, yearNum: e.target.value })} className={inputCls} />
            </div>
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={busy} className="flex-1 px-6 py-3 rounded-xl bg-amber-500 text-white font-bold text-sm flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{t('saveChanges')}</span>
              </button>
              <button type="button" onClick={() => setEditingExam(null)} className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm">{t('cancel')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
