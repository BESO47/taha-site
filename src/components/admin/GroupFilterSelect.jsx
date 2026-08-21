import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, Loader2 } from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { fetchGroups } from '../../lib/api'

/**
 * LocalStorage key shared by every GroupFilterSelect instance so the
 * selection survives reloads and is consistent across all modules.
 */
export const GROUP_FILTER_STORAGE_KEY = 'physics_hub_group_filter'

/**
 * Read the initial group filter from the URL query param (?groupId=...),
 * falling back to localStorage and finally 'all'.
 */
export function getInitialGroupFilter() {
  if (typeof window === 'undefined') return 'all'
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('groupId')
    if (fromUrl) return fromUrl
    return localStorage.getItem(GROUP_FILTER_STORAGE_KEY) || 'all'
  } catch (_) {
    return 'all'
  }
}

/**
 * Universal, reusable group filter dropdown.
 *
 * - Renders "All Groups" + every group from the database (plus an optional
 *   "No group assigned" entry).
 * - Persists the selection to the URL query param `?groupId=<id>` AND to
 *   localStorage, so the filter survives page reloads and module switches.
 * - Controlled component: parent owns `value`/`onChange`; the component
 *   synchronizes the URL/localStorage whenever the user picks a group.
 *
 * @param {object} props
 * @param {string} props.value          selected group id or 'all' (or 'none')
 * @param {(groupId: string) => void} props.onChange
 * @param {Array<{id: string, name: string, year_id?: string}>} [props.groups]
 * @param {boolean} [props.includeNone]  add a "No group assigned" option
 * @param {boolean} [props.showYear]     show the group's grade badge
 * @param {string}  [props.label]        custom label text
 * @param {string}  [props.className]    extra wrapper classes
 * @param {boolean} [props.compact]
 */
export default function GroupFilterSelect({
  value,
  onChange,
  groups: groupsProp,
  includeNone = false,
  showYear = true,
  label,
  className = '',
  compact = false,
}) {
  const { t, lang } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const [groups, setGroups] = useState(groupsProp || null)
  const [loading, setLoading] = useState(!groupsProp)

  useEffect(() => {
    if (groupsProp) {
      setGroups(groupsProp)
      return
    }
    let mounted = true
    fetchGroups()
      .then((g) => { if (mounted) setGroups(g) })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [groupsProp])

  // Keep the URL param in sync if the value changes from elsewhere
  useEffect(() => {
    const param = searchParams.get('groupId')
    if (value && value !== 'all' && value !== 'none' && param !== value) {
      const next = new URLSearchParams(searchParams)
      next.set('groupId', value)
      setSearchParams(next, { replace: true })
    }
    if (value === 'all' || value === 'none') {
      if (param) {
        const next = new URLSearchParams(searchParams)
        next.delete('groupId')
        setSearchParams(next, { replace: true })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const handleChange = (id) => {
    // Persist to localStorage for cross-module consistency
    try { localStorage.setItem(GROUP_FILTER_STORAGE_KEY, id) } catch (_) {}

    // Persist to the URL query param (?groupId=group_123)
    const next = new URLSearchParams(searchParams)
    if (id === 'all' || id === 'none') next.delete('groupId')
    else next.set('groupId', id)
    setSearchParams(next, { replace: true })

    onChange?.(id)
  }

  const finalLabel = label || t('filterByGroup')
  const list = groups || []

  return (
    <div className={className}>
      <label className={`block font-bold mb-1 text-slate-500 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        {finalLabel}
      </label>
      <div className="relative">
        <Layers className={`w-4 h-4 text-yellow-500 absolute top-1/2 -translate-y-1/2 pointer-events-none ${lang === 'ar' ? 'right-3' : 'left-3'}`} />
        <select
          value={value || 'all'}
          onChange={(e) => handleChange(e.target.value)}
          className={`w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black font-bold focus:outline-none focus:ring-2 focus:ring-yellow-400 ${compact ? 'px-3 py-2 text-xs ltr:pl-9 rtl:pr-9' : 'px-3.5 py-2.5 text-xs sm:text-sm ltr:pl-10 rtl:pr-10'}`}
        >
          <option value="all">{t('allGroups')}</option>
          {includeNone && <option value="none">{t('noGroupAssigned')}</option>}
          {list.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {showYear && g.year_id
                ? ` (${lang === 'ar' ? (YEARS_MAP[g.year_id]?.shortTitleAr || g.year_id) : (YEARS_MAP[g.year_id]?.shortTitle || g.year_id)})`
                : ''}
            </option>
          ))}
        </select>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-500 absolute bottom-2.5 ltr:right-8 rtl:left-8" />}
      </div>
    </div>
  )
}

// Small static map to avoid pulling the whole dummyData import graph into
// every admin tab. KEYS = year ids.
const YEARS_MAP = {
  5: { shortTitle: '2nd Sec', shortTitleAr: 'تانية ثانوي' },
  6: { shortTitle: '3rd Sec', shortTitleAr: 'ثالثة ثانوي' },
}
