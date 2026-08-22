import { useState, useEffect, useCallback } from 'react'
import { Video, Plus, Trash2, Loader2, Eye, EyeOff } from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/catalog'
import { fetchVideos, createVideo, updateVideo, deleteVideo } from '../../lib/api'
import { extractYouTubeId } from '../../lib/driveUtils'

const EMPTY = { title: '', description: '', youtubeUrl: '', yearId: '5', unit: '', isPublished: true, sortOrder: 0 }

export default function VideosTab() {
  const { t, lang } = useLanguage()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setItems(await fetchVideos({ publishedOnly: false })) }
    catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    if (!extractYouTubeId(form.youtubeUrl)) {
      setError(lang === 'ar' ? 'رابط يوتيوب غير صالح.' : 'That is not a valid YouTube URL.')
      return
    }
    setSaving(true)
    try {
      await createVideo(form)
      setForm(EMPTY)
      await load()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const togglePublish = async (v) => {
    try {
      await updateVideo(v.id, {
        title: v.title, description: v.description, youtubeUrl: v.youtube_url,
        yearId: v.year_id, unit: v.unit, isPublished: !v.is_published, sortOrder: v.sort_order,
      })
      await load()
    } catch (err) { alert(err.message) }
  }

  const handleDelete = async (id) => {
    if (!confirm(lang === 'ar' ? 'حذف هذا الفيديو؟' : 'Delete this video?')) return
    try { await deleteVideo(id); await load() }
    catch (err) { alert(err.message) }
  }

  const previewId = extractYouTubeId(form.youtubeUrl)

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center gap-2 font-bold text-lg">
          <Video className="w-5 h-5 text-red-500" />
          <span>{t('addVideo')}</span>
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
            <label className="block text-xs font-bold mb-1.5">YouTube URL</label>
            <input
              type="url" required value={form.youtubeUrl}
              onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value })}
              placeholder="https://www.youtube.com/watch?v=..."
              dir="ltr"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-mono"
            />
          </div>

          {previewId && (
            <div className="sm:col-span-2 flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800">
              <img
                src={`https://img.youtube.com/vi/${previewId}/mqdefault.jpg`}
                alt="preview" className="w-24 sm:w-28 rounded-lg shrink-0"
              />
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Video ID</p>
                <span className="text-xs font-mono text-slate-500 break-all">{previewId}</span>
              </div>
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="block text-xs font-bold mb-1.5">{t('description')}</label>
            <textarea
              rows={2} value={form.description}
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
            <label className="block text-xs font-bold mb-1.5">{lang === 'ar' ? 'الوحدة' : 'Unit'}</label>
            <input
              type="text" value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
            />
          </div>

          {error && <p className="sm:col-span-2 text-xs font-bold text-red-600">{error}</p>}

          <div className="sm:col-span-2">
            <button
              type="submit" disabled={saving}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 active:scale-[0.99] disabled:opacity-60 text-black font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-yellow-400/20 transition"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>{t('addVideo')}</span>
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
        <h3 className="font-bold text-lg">{t('adminVideos')}</h3>
        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
        ) : items.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-8">{t('noVideosYet')}</p>
        ) : (
          <div className="space-y-2">
            {items.map((v) => {
              const vid = extractYouTubeId(v.youtube_url)
              return (
                <div key={v.id} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800">
                  {vid && (
                    <img src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`} alt="" className="w-24 rounded-lg shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{v.title}</p>
                    <p className="text-[11px] text-slate-500">
                      {lang === 'ar' ? YEARS.find((y) => y.id === v.year_id)?.titleAr : YEARS.find((y) => y.id === v.year_id)?.title}
                      {v.unit ? ` · ${v.unit}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => togglePublish(v)}
                      title={v.is_published ? 'published' : 'hidden'}
                      className={`p-1.5 rounded-lg ${
                        v.is_published
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-500'
                      }`}
                    >
                      {v.is_published ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDelete(v.id)}
                      className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 hover:bg-red-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
