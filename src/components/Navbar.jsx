import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X, Sun, Moon, LogIn, LogOut, UserPlus, FileText, Home, User, BookOpen, ChevronDown, Globe, Zap, ClipboardList, LayoutDashboard } from 'lucide-react'
import { YEARS } from '../data/catalog'
import { useLanguage } from '../lib/i18n.jsx'
import { useAuth } from '../lib/auth.jsx'

export default function Navbar() {
  const { lang, toggleLanguage, t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('theme')
    if (saved) return saved === 'dark'
    return true
  })
  const { session, profile, isAdmin, loading: checkingSession, signOut } = useAuth()
  const userName = profile?.full_name || session?.user?.email || ''
  const [lessonsMenuOpen, setLessonsMenuOpen] = useState(false)
  const [mobileLessonsOpen, setMobileLessonsOpen] = useState(false)
  const lessonsMenuRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    setOpen(false)
    setLessonsMenuOpen(false)
    setMobileLessonsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (lessonsMenuRef.current && !lessonsMenuRef.current.contains(e.target)) {
        setLessonsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = async () => {
    await signOut()
    navigate('/')
  }

  const isActive = (path) => location.pathname === path
  // "Lessons" covers the lessons hub, a single lesson and the year pages.
  const isLessonsActive =
    location.pathname === '/lessons' ||
    location.pathname.startsWith('/lessons/') ||
    location.pathname.startsWith('/years/')
  const isHomeworkActive = location.pathname.startsWith('/homework')

  return (
    <nav className="navbar z-50 sticky top-2 smooth bg-black/90 text-white mx-3 rounded-2xl shadow-2xl border border-yellow-400/30 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20">
        <div className="relative flex items-center justify-between h-full">
          {/* Brand Logo & Name */}
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="h-10 sm:h-12 w-10 sm:w-12 rounded-2xl bg-yellow-400 text-black flex items-center justify-center font-extrabold text-xl shadow-lg shadow-yellow-400/20 group-hover:scale-105 transition">
                <Zap className="w-6 h-6 text-black fill-current" />
              </div>
              <div className="flex flex-col">
                <span className="font-extrabold text-lg sm:text-xl tracking-tight leading-tight text-white font-outfit">
                  Physics Hub
                </span>
                <span className="text-[11px] text-yellow-400 font-extrabold tracking-wide">
                  Eng Taha Elsabagh
                </span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <div className="hidden md:flex items-center gap-1 font-ibm text-sm font-bold ltr:ml-4 rtl:mr-4">
              <Link
                to="/"
                className={`px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 ${isActive('/')
                  ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 shadow-inner'
                  : 'text-zinc-300 hover:bg-zinc-800 hover:text-yellow-400'
                  }`}
              >
                <Home className="w-4 h-4" />
                <span>{t('navHome')}</span>
              </Link>

              {/* Lessons — video lessons & materials only */}
              <div className="relative flex items-center" ref={lessonsMenuRef}>
                <Link
                  to="/lessons"
                  className={`ltr:rounded-l-xl rtl:rounded-r-xl px-3.5 py-2 transition flex items-center gap-1.5 ${isLessonsActive
                    ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 ltr:border-r-0 rtl:border-l-0 shadow-inner'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-yellow-400'
                    }`}
                >
                  <BookOpen className="w-4 h-4" />
                  <span>{t('navLessons')}</span>
                </Link>
                <button
                  onClick={() => setLessonsMenuOpen((v) => !v)}
                  aria-label={t('navLessons')}
                  className={`ltr:rounded-r-xl rtl:rounded-l-xl px-2 py-2 transition flex items-center ${isLessonsActive
                    ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 ltr:border-l-0 rtl:border-r-0 shadow-inner'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-yellow-400'
                    }`}
                  aria-expanded={lessonsMenuOpen}
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${lessonsMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {lessonsMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.15 }}
                      className={`absolute top-full mt-2 w-72 bg-zinc-900 rounded-2xl shadow-2xl border border-yellow-400/30 p-2 text-white z-50 max-h-80 overflow-y-auto ${lang === 'ar' ? 'right-0' : 'left-0'
                        }`}
                    >
                      <Link
                        to="/lessons"
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold bg-yellow-400/10 text-yellow-300 hover:bg-yellow-400/20 transition mb-1"
                      >
                        <BookOpen className="w-4 h-4" />
                        <span>{t('allLessonsMenu')}</span>
                      </Link>
                      <div className="h-px bg-zinc-800 my-1" />
                      {YEARS.map((y) => (
                        <Link
                          key={y.id}
                          to={`/years/${y.id}`}
                          className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-bold hover:bg-yellow-400/15 hover:text-yellow-400 transition"
                        >
                          <span>{lang === 'ar' ? y.titleAr : y.title}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-300 border border-yellow-400/30">
                            {lang === 'ar' ? y.badgeAr : y.badge}
                          </span>
                        </Link>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <Link
                to="/exams"
                className={`px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 ${isActive('/exams')
                  ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 shadow-inner'
                  : 'text-zinc-300 hover:bg-zinc-800 hover:text-yellow-400'
                  }`}
              >
                <FileText className="w-4 h-4" />
                <span>{t('navPastExams')}</span>
              </Link>

              {session && (
                <Link
                  to="/homework"
                  className={`px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 ${isHomeworkActive
                    ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 shadow-inner'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-yellow-400'
                    }`}
                >
                  <ClipboardList className="w-4 h-4" />
                  <span>{t('navHomework')}</span>
                </Link>
              )}

              {session && !isAdmin && (
                <Link
                  to="/profile"
                  className={`px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 ${isActive('/profile')
                    ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 shadow-inner'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-yellow-400'
                    }`}
                >
                  <User className="w-4 h-4" />
                  <span>{t('navProfile')}</span>
                </Link>
              )}

              {isAdmin && (
                <Link
                  to="/admin"
                  className={`px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 ${isActive('/admin')
                    ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 shadow-inner'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-yellow-400'
                    }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>{t('navAdmin')}</span>
                </Link>
              )}
            </div>
          </div>

          {/* Right side buttons (Desktop & Toggles) */}
          <div className="hidden md:flex items-center gap-2.5">
            {/* Language Toggle Button */}
            <button
              onClick={toggleLanguage}
              className="py-2 px-3.5 rounded-xl bg-yellow-400/15 hover:bg-yellow-400/25 text-yellow-300 text-xs font-extrabold flex items-center gap-1.5 transition border border-yellow-400/40"
              aria-label={t('switchLangLabel')}
              title={t('switchLangLabel')}
            >
              <Globe className="w-4 h-4 text-yellow-400" />
              <span>{t('languageName')}</span>
            </button>

            {/* Dark mode toggle */}
            <button
              onClick={() => setDark((v) => !v)}
              className="py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center gap-1.5 transition border border-zinc-700"
              aria-label="Toggle Theme"
            >
              {dark ? (
                <>
                  <Sun className="w-4 h-4 text-yellow-400" />
                  <span>{t('lightMode')}</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-yellow-300" />
                  <span>{t('darkMode')}</span>
                </>
              )}
            </button>

            {checkingSession ? null : session ? (
              <>
                <div className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-200 max-w-[150px]">
                  <User className="w-4 h-4 text-yellow-400 shrink-0" />
                  <span className="truncate">{userName}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white shadow transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span>{t('navLogout')}</span>
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/register"
                  className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border border-yellow-400/40 text-yellow-400 hover:bg-yellow-400 hover:text-black shadow transition"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{t('navRegister')}</span>
                </Link>

                <Link
                  to="/login"
                  className="px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-black shadow-lg shadow-yellow-400/20 transition"
                >
                  <LogIn className="w-4 h-4" />
                  <span>{t('navLogin')}</span>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Actions Header */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={toggleLanguage}
              className="p-2 rounded-xl bg-yellow-400/15 text-yellow-300 text-xs font-extrabold flex items-center gap-1 border border-yellow-400/40"
              aria-label={t('switchLangLabel')}
            >
              <Globe className="w-4 h-4 text-yellow-400" />
              <span>{lang === 'en' ? 'AR' : 'EN'}</span>
            </button>

            <button
              onClick={() => setDark((v) => !v)}
              className="p-2 rounded-xl bg-zinc-800 text-zinc-200"
              aria-label="Toggle Theme"
            >
              {dark ? <Sun className="w-5 h-5 text-yellow-400" /> : <Moon className="w-5 h-5 text-yellow-300" />}
            </button>

            <button
              onClick={() => setOpen((v) => !v)}
              className="p-2 rounded-xl text-white hover:bg-white/10"
              aria-expanded={open}
            >
              {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-zinc-800 px-4 pt-3 pb-5 flex flex-col gap-2 font-ibm bg-zinc-950/95"
          >
            <Link
              to="/"
              className="px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:bg-zinc-800 hover:text-yellow-400 flex items-center gap-2"
            >
              <Home className="w-4 h-4" />
              <span>{t('navHome')}</span>
            </Link>

            <div>
              <div className="flex items-center gap-1">
                <Link
                  to="/lessons"
                  className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 ${isLessonsActive
                    ? 'bg-yellow-400/20 text-yellow-400'
                    : 'text-white hover:bg-zinc-800 hover:text-yellow-400'
                    }`}
                >
                  <BookOpen className="w-4 h-4" />
                  <span>{t('navLessons')}</span>
                </Link>
                <button
                  onClick={() => setMobileLessonsOpen((v) => !v)}
                  aria-label={t('navLessons')}
                  className="px-3 py-2.5 rounded-xl text-white hover:bg-zinc-800 hover:text-yellow-400"
                  aria-expanded={mobileLessonsOpen}
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${mobileLessonsOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              <AnimatePresence>
                {mobileLessonsOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="ltr:pl-6 rtl:pr-6 flex flex-col gap-1 mt-1 overflow-hidden"
                  >
                    {YEARS.map((y) => (
                      <Link
                        key={y.id}
                        to={`/years/${y.id}`}
                        className="px-4 py-2 rounded-lg text-xs font-bold text-zinc-300 hover:bg-yellow-400/20 hover:text-yellow-400 transition"
                      >
                        {lang === 'ar' ? y.titleAr : y.title}
                      </Link>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Link
              to="/exams"
              className="px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:bg-zinc-800 hover:text-yellow-400 flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              <span>{t('navPastExams')}</span>
            </Link>

            {session && (
              <Link
                to="/homework"
                className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 ${isHomeworkActive
                  ? 'bg-yellow-400/20 text-yellow-400'
                  : 'text-white hover:bg-zinc-800 hover:text-yellow-400'
                  }`}
              >
                <ClipboardList className="w-4 h-4" />
                <span>{t('navHomework')}</span>
              </Link>
            )}

            {session && !isAdmin && (
              <Link
                to="/profile"
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:bg-zinc-800 hover:text-yellow-400 flex items-center gap-2"
              >
                <User className="w-4 h-4" />
                <span>{t('navProfile')}</span>
              </Link>
            )}

            {isAdmin && (
              <Link
                to="/admin"
                className="px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:bg-zinc-800 hover:text-yellow-400 flex items-center gap-2"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>{t('navAdmin')}</span>
              </Link>
            )}

            <div className="pt-2 border-t border-zinc-800 flex flex-col gap-2">
              {checkingSession ? null : session ? (
                <>
                  <div className="px-4 py-2.5 rounded-xl text-sm font-bold text-center bg-zinc-900 text-zinc-200 flex items-center justify-center gap-2 border border-zinc-800">
                    <User className="w-4 h-4 text-yellow-400" />
                    <span className="truncate">{userName}</span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-center bg-red-600 text-white flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{t('navLogout')}</span>
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/register"
                    className="px-4 py-2.5 rounded-xl text-sm font-bold text-center border border-yellow-400/40 text-yellow-400 flex items-center justify-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>{t('navRegister')}</span>
                  </Link>
                  <Link
                    to="/login"
                    className="px-4 py-2.5 rounded-xl text-sm font-extrabold text-center bg-yellow-400 text-black flex items-center justify-center gap-2"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{t('navLogin')}</span>
                  </Link>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}