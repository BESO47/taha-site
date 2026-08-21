import { useState } from 'react'
import { motion } from 'framer-motion'
import { Lock, PlayCircle, Video, ChevronDown, ShieldCheck, Clock3 } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'
import ProtectedVideoPlayer from './ProtectedVideoPlayer.jsx'

/**
 * =====================================================================
 * Homework explanation video — GATED ACCESS
 * ---------------------------------------------------------------------
 * The video that explains how to solve a homework assignment stays
 * locked and unplayable until the student's submission is recorded as
 * graded (auto-marked MCQ homework grades instantly; essay/file homework
 * unlocks as soon as the teacher records a grade).
 *
 * The player component is only mounted when `unlocked` is true, so the
 * video URL is never rendered into the DOM while the work is pending.
 * =====================================================================
 */
export default function HomeworkExplanationVideo({
  title,
  videoUrl,
  unlocked = false,
  status = 'pending',
  studentInfo,
}) {
  const { t, lang } = useLanguage()
  const [open, setOpen] = useState(false)

  if (!videoUrl) return null

  const label = title || t('explanationVideoTitle')

  /* ------------------------------ LOCKED ------------------------------ */
  if (!unlocked) {
    return (
      <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
        <div className="relative">
          {/* Blurred placeholder: no video element, no URL in the DOM */}
          <div className="h-36 bg-gradient-to-br from-slate-800 to-zinc-900 flex items-center justify-center blur-[2px] opacity-70">
            <Video className="w-12 h-12 text-zinc-500" />
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-4">
            <div className="w-11 h-11 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-lg">
              <Lock className="w-6 h-6" />
            </div>
            <p className="text-xs font-extrabold text-white drop-shadow">
              {t('explanationVideoLocked')}
            </p>
          </div>
        </div>

        <div className="p-4 space-y-1.5">
          <p className="text-xs font-extrabold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            <span>{label}</span>
          </p>
          <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
            <Clock3 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              {status === 'submitted' || status === 'returned'
                ? t('explanationVideoAwaitingGrade')
                : t('explanationVideoHint')}
            </span>
          </p>
        </div>
      </div>
    )
  }

  /* ----------------------------- UNLOCKED ----------------------------- */
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 overflow-hidden"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-start hover:bg-emerald-100/60 dark:hover:bg-emerald-900/30 transition"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow">
            <PlayCircle className="w-5 h-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-extrabold text-emerald-800 dark:text-emerald-300 truncate">
              {label}
            </span>
            <span className="block text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              {t('explanationVideoUnlocked')}
            </span>
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="p-4 pt-0">
          <ProtectedVideoPlayer
            videoUrl={videoUrl}
            title={label}
            studentInfo={studentInfo}
          />
          <p className="mt-2 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
            {lang === 'ar'
              ? 'شاهد الشرح وقارن خطواتك بالحل النموذجي.'
              : 'Watch the walkthrough and compare it with your own solution.'}
          </p>
        </div>
      )}
    </motion.div>
  )
}
