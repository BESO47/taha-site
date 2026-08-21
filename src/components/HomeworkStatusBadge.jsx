import { Clock3, Send, Award, Unlock, RotateCcw } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'

/**
 * Status badges for a homework assignment:
 *   pending → submitted → graded ( + "video unlocked" chip )
 */
const STYLES = {
  pending: 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300 border-slate-200 dark:border-zinc-700',
  submitted: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  graded: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  returned: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800',
}

const ICONS = {
  pending: Clock3,
  submitted: Send,
  graded: Award,
  returned: RotateCcw,
}

export function HomeworkStatusBadge({ status = 'pending', className = '' }) {
  const { t } = useLanguage()
  const Icon = ICONS[status] || Clock3
  const labels = {
    pending: t('statusPending'),
    submitted: t('statusSubmitted'),
    graded: t('statusGraded'),
    returned: t('statusReturned'),
  }

  return (
    <span
      className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold border inline-flex items-center gap-1.5 ${STYLES[status] || STYLES.pending} ${className}`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{labels[status] || labels.pending}</span>
    </span>
  )
}

export function VideoUnlockedBadge({ unlocked = false, className = '' }) {
  const { t } = useLanguage()
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold border inline-flex items-center gap-1.5 ${
        unlocked
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800'
      } ${className}`}
    >
      {unlocked ? <Unlock className="w-3.5 h-3.5" /> : <Clock3 className="w-3.5 h-3.5" />}
      <span>{unlocked ? t('statusVideoUnlocked') : t('statusVideoLocked')}</span>
    </span>
  )
}

export default HomeworkStatusBadge
