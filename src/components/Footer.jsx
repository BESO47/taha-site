import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n.jsx'

function YoutubeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" {...props}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

function FacebookIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" {...props}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

const SOCIALS = [
  { icon: YoutubeIcon, name: 'YouTube', href: 'https://www.youtube.com/channel/UCZmQMG4vx3xncQogurpyCDw' },
  { icon: FacebookIcon, name: 'Facebook', href: 'https://www.facebook.com/profile.php?id=61567028243039' },
]

export default function Footer() {
  const { lang, t } = useLanguage()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    checkAdminAccess()

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      checkAdminAccess()
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const checkAdminAccess = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setIsAdmin(false)
      return
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()

    setIsAdmin(!error && profile?.role === 'admin')
  }

  return (
    <footer className="py-12 bg-slate-900 dark:bg-black text-white font-ibm relative overflow-hidden border-t border-slate-800 dark:border-yellow-400/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 items-center">
          {/* Col 1: Brand info */}
          <div className={`space-y-4 text-center ${lang === 'ar' ? 'md:text-right' : 'md:text-left'}`}>
            <Link to="/" className="inline-flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-yellow-400 text-black flex items-center justify-center font-extrabold text-2xl shadow-lg shadow-yellow-400/20">
                <Zap className="w-7 h-7 fill-current" />
              </div>
              <div>
                <span className="font-extrabold text-xl block text-white font-outfit">
                  Physics Hub
                </span>
                <span className="text-xs text-yellow-400 font-extrabold">{t('sloganAr')}</span>
              </div>
            </Link>
            <p className="text-xs text-slate-300 dark:text-zinc-400 leading-relaxed max-w-sm">
              {t('footerDesc')}
            </p>
          </div>

          {/* Col 2: Social media */}
          <div className="space-y-3 text-center">
            <p className="text-xs font-bold text-slate-300 dark:text-zinc-300">{t('socialHeader')}</p>
            <div className="flex gap-4 justify-center">
              {SOCIALS.map((s) => {
                const Icon = s.icon
                return (
                  <a
                    key={s.name}
                    href={s.href}
                    target="_blank"
                    rel="noreferrer"
                    className="w-11 h-11 rounded-2xl bg-slate-800 dark:bg-zinc-900 hover:bg-yellow-400 hover:text-black border border-slate-700 dark:border-zinc-800 flex items-center justify-center text-slate-200 dark:text-zinc-300 transition shadow-sm"
                    aria-label={s.name}
                  >
                    <Icon className="w-5 h-5" />
                  </a>
                )
              })}
            </div>
          </div>

          {/* Col 3: CTA */}
          <div className={`space-y-4 text-center ${lang === 'ar' ? 'md:text-left flex flex-col items-center md:items-end' : 'md:text-right flex flex-col items-center md:items-end'}`}>
            <h3 className="font-extrabold text-lg text-white font-outfit">
              {t('ctaHeader')}
            </h3>
            <Link
              to="/register"
              className="px-6 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-sm shadow-lg shadow-yellow-400/20 transition flex items-center gap-2"
            >
              <span>{t('ctaButton')}</span>
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <div className="h-px bg-slate-800 dark:bg-zinc-900 w-full" />

        {/* Bottom credits */}
        <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 dark:text-zinc-400 gap-4">
          <p>© {new Date().getFullYear()} {t('rights')}</p>

          {isAdmin && (
            <Link to="/admin" className="text-yellow-400 hover:underline font-bold transition flex items-center gap-1">
              <span>{t('adminLink')}</span>
            </Link>
          )}
        </div>
      </div>
    </footer>
  )
}