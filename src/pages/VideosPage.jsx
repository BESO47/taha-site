import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Video, Loader2, Sparkles, PlayCircle } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'
import { YEARS } from '../data/dummyData'
import { fetchVideos } from '../lib/api'
import { extractYouTubeId } from '../lib/driveUtils'

export default function VideosPage() {
  const { t, lang } = useLanguage()
  const { profile } = useAuth()
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [yearFilter, setYearFilter] = useState('all')
  const [active, setActive] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchVideos({ yearId: yearFilter })
      .then((data) => { if (alive) { setVideos(data); setActive(data[0] || null) } })
      .catch((err) => console.error('Failed to load videos:', err))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [yearFilter])

  useEffect(() => {
    if (profile?.year_id) setYearFilter(profile.year_id)
  }, [profile?.year_id])

  const activeId = active ? extractYouTubeId(active.youtube_url) : null

  return (
    <div className="min-h-screen py-10 px-4 sm:px-8 max-w-7xl mx-auto space-y-8 font-ibm bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl bg-slate-900 dark:bg-zinc-900 text-white p-8 sm:p-12 shadow-2xl border border-slate-800 dark:border-yellow-400/30 space-y-4"
      >
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-yellow-400/20 border border-yellow-400/40 text-xs font-bold text-yellow-300">
          <Sparkles className="w-4 h-4 text-yellow-400" />
          <span>{t('slogan')}</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold font-outfit">{t('videosTitle')}</h1>
        <p className="text-base text-slate-300">{t('videosSubtitle')}</p>
      </motion.div>

      {/* Grade filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setYearFilter('all')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition ${
            yearFilter === 'all' ? 'bg-yellow-400 text-black shadow' : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400'
          }`}
        >
          {t('allGrades')}
        </button>
        {YEARS.map((y) => (
          <button
            key={y.id}
            onClick={() => setYearFilter(y.id)}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition ${
              yearFilter === y.id ? 'bg-yellow-400 text-black shadow' : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400'
            }`}
          >
            {lang === 'ar' ? y.shortTitleAr : y.shortTitle}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-yellow-500 flex flex-col items-center gap-3 font-bold">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span>{t('loading')}</span>
        </div>
      ) : videos.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-zinc-900 rounded-3xl border border-dashed border-slate-300 dark:border-zinc-800 text-slate-500 space-y-3">
          <Video className="w-12 h-12 mx-auto text-slate-400 dark:text-zinc-600" />
          <p className="font-bold text-lg">{t('noVideosYet')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Player */}
          <div className="lg:col-span-2 space-y-4">
            <div className="aspect-video rounded-3xl overflow-hidden bg-black shadow-2xl border border-slate-200 dark:border-zinc-800">
              {activeId ? (
                <iframe
                  key={activeId}
                  src={`https://www.youtube.com/embed/${activeId}?rel=0&modestbranding=1`}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title={active?.title}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-500">
                  <PlayCircle className="w-16 h-16" />
                </div>
              )}
            </div>
            {active && (
              <div className="space-y-2">
                <h2 className="text-xl sm:text-2xl font-bold font-outfit">{active.title}</h2>
                {active.description && (
                  <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">{active.description}</p>
                )}
              </div>
            )}
          </div>

          {/* Playlist */}
          <div className="space-y-3 lg:max-h-[600px] lg:overflow-y-auto">
            {videos.map((v) => {
              const vid = extractYouTubeId(v.youtube_url)
              const isActive = active?.id === v.id
              return (
                <button
                  key={v.id}
                  onClick={() => setActive(v)}
                  className={`w-full flex gap-3 p-3 rounded-2xl border text-start transition ${
                    isActive
                      ? 'bg-yellow-400/15 border-yellow-400/60'
                      : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 hover:border-yellow-400/40'
                  }`}
                >
                  <div className="w-28 aspect-video rounded-lg overflow-hidden bg-slate-200 dark:bg-zinc-800 shrink-0">
                    {vid && (
                      <img
                        src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`}
                        alt={v.title}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-bold text-sm line-clamp-2">{v.title}</p>
                    {v.unit && <p className="text-[11px] text-slate-500 truncate">{v.unit}</p>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
