import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { User, Phone, Lock, Eye, EyeOff, GraduationCap, MapPin, Sparkles, UserCheck, ArrowRight, ArrowLeft, Layers } from 'lucide-react'
import { YEARS, GOVERNORATES } from '../data/catalog'
import { supabase } from '../lib/supabase'
import { normalizePhone, validatePhone } from '../lib/whatsapp'
import { useLanguage } from '../lib/i18n.jsx'
import { fetchRegistrationGroups } from '../lib/api'

export default function RegisterPage() {
  const { lang, t } = useLanguage()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [parentPhone, setParentPhone] = useState('')
  const [selectedYear, setSelectedYear] = useState('5') // default 2nd Sec
  const [governorate, setGovernorate] = useState('القاهرة')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)

  // Group selection. The list is loaded from the backend for the CURRENT
  // grade only; changing the grade clears the choice and reloads.
  const [allGroups, setAllGroups] = useState([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [groupsError, setGroupsError] = useState('')
  const [groupsReloadKey, setGroupsReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoadingGroups(true)
    setGroupsError('')
    setSelectedGroupId('') // 1.2 — a grade change always clears the group
    fetchRegistrationGroups(selectedYear)
      .then((groups) => {
        if (cancelled) return
        // The server already filters by grade; the client re-checks so a
        // stale/cached row can never offer another grade's group.
        setAllGroups(
          (groups || []).filter(
            (g) => !g.year_id || String(g.year_id) === String(selectedYear)
          )
        )
      })
      .catch((err) => {
        // 8 — never turn a backend failure into "there are no groups".
        if (cancelled) return
        setAllGroups([])
        console.error('Failed to load registration groups:', err)
        setGroupsError(
          lang === 'ar'
            ? 'تعذر تحميل المجموعات. برجاء المحاولة مرة أخرى.'
            : 'Unable to load groups. Please try again.'
        )
      })
      .finally(() => { if (!cancelled) setLoadingGroups(false) })
    return () => { cancelled = true }
  }, [selectedYear, groupsReloadKey, lang])

  const availableGroups = allGroups

  const ArrowIcon = lang === 'ar' ? ArrowLeft : ArrowRight

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    if (!fullName || !email || !phone || !parentPhone || !password || !confirmPassword) {
      setErrorMsg(lang === 'ar' ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill out all required fields.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMsg(lang === 'ar' ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match.')
      return
    }

    if (password.length < 8) {
      setErrorMsg(lang === 'ar' ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' : 'Password must be at least 8 characters.')
      return
    }

    const studentPhone = validatePhone(phone)
    const guardianPhone = validatePhone(parentPhone)
    if (!studentPhone.isValid || !guardianPhone.isValid) {
      setErrorMsg(lang === 'ar' ? 'تحقق من صيغة رقم الطالب وولي الأمر.' : 'Check the student and guardian phone numbers.')
      return
    }

    const cleanName = fullName.trim().replace(/\s+/g, ' ')
    const cleanEmail = email.trim().toLowerCase()
    if (cleanName.length < 2 || cleanName.length > 120) {
      setErrorMsg(lang === 'ar' ? 'يجب أن يكون الاسم بين حرفين و120 حرفاً.' : 'Name must be between 2 and 120 characters.')
      return
    }

    // 1.3 — never post a group that does not belong to the chosen grade.
    // The database re-validates and refuses the signup, this is only so
    // the student gets a precise message instead of a generic failure.
    if (selectedGroupId && !availableGroups.some((g) => String(g.id) === String(selectedGroupId))) {
      setErrorMsg(
        lang === 'ar'
          ? 'المجموعة المختارة غير صالحة لهذا الصف.'
          : 'Your selected group is not valid for this grade.'
      )
      return
    }

    setIsLoading(true)

    try {
      // The database auth trigger creates the profile atomically from this
      // metadata. This also works when email confirmation means signUp does
      // not return a session (a direct browser INSERT would fail RLS).
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: cleanName,
            phone: normalizePhone(studentPhone.normalized),
            parent_phone: normalizePhone(guardianPhone.normalized),
            year_id: String(selectedYear),
            governorate,
            ...(selectedGroupId ? { group_id: selectedGroupId } : {}),
          },
        },
      })

      if (authError) {
        if (authError.message?.toLowerCase().includes('already registered')) {
          setErrorMsg(lang === 'ar' ? 'هذا البريد الإلكتروني مُسجّل بالفعل.' : 'This email is already registered.')
        } else if (authError.code === 'email_address_invalid') {
          setErrorMsg(lang === 'ar' ? 'صيغة البريد الإلكتروني غير صحيحة.' : 'Invalid email address format.')
        } else if (selectedGroupId && /database error/i.test(authError.message || '')) {
          // The signup trigger validates the group against the grade and
          // aborts the account creation when they do not match.
          setErrorMsg(
            lang === 'ar'
              ? 'تعذر حفظ المجموعة المختارة: المجموعة غير صالحة لهذا الصف.'
              : 'Unable to save the selected group: it is not valid for this grade.'
          )
        } else {
          setErrorMsg(lang === 'ar' ? 'حدث خطأ أثناء إنشاء الحساب، حاول مجدداً.' : 'An error occurred during account creation.')
        }
        setIsLoading(false)
        return
      }

      if (!authData.user) {
        setErrorMsg(lang === 'ar' ? 'حدث خطأ غير متوقع، حاول مجدداً.' : 'An unexpected error occurred.')
        setIsLoading(false)
        return
      }

      setIsLoading(false)
      setIsSuccess(true)

      // Celebration is non-critical and loaded only after successful signup.
      import('canvas-confetti')
        .then(({ default: confetti }) => confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } }))
        .catch(() => {})

      setTimeout(() => {
        navigate('/')
      }, 2000)
    } catch (err) {
      console.error(err)
      setErrorMsg(lang === 'ar' ? 'حدث خطأ غير متوقع، حاول مجدداً.' : 'An unexpected error occurred.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-[90vh] flex items-center justify-center px-4 py-12 relative overflow-hidden font-ibm bg-slate-50 dark:bg-black">
      {/* Ambient glow */}
      <div className="absolute top-10 ltr:right-10 rtl:left-10 w-96 h-96 bg-yellow-400/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 ltr:left-10 rtl:right-10 w-96 h-96 bg-yellow-500/10 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 25, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-2xl z-10"
      >
        <div className="bg-white dark:bg-zinc-900 backdrop-blur-md rounded-3xl p-6 sm:p-10 shadow-2xl border border-slate-200 dark:border-zinc-800 relative overflow-hidden">
          {/* Top banner accent */}
          <div className="absolute top-0 inset-x-0 h-2 bg-yellow-400" />

          {/* Header */}
          <div className="text-center space-y-2 mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 mb-2 shadow-inner border border-yellow-400/30">
              <UserCheck className="w-8 h-8" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold font-outfit text-slate-900 dark:text-white">
              {t('registerTitle')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-zinc-400 font-ibm">
              {t('registerSubtitle')}
            </p>
          </div>

          {/* Messages */}
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-bold text-center"
            >
              {errorMsg}
            </motion.div>
          )}

          {isSuccess && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-6 p-5 rounded-2xl bg-yellow-400/20 border border-yellow-400/40 text-yellow-800 dark:text-yellow-300 text-center font-ibm space-y-2"
            >
              <div className="flex items-center justify-center gap-2 font-bold text-lg">
                <Sparkles className="w-6 h-6 text-yellow-500 animate-bounce" />
                <span>{lang === 'ar' ? 'تم إنشاء الحساب بنجاح!' : 'Account Created Successfully!'}</span>
              </div>
              <p className="text-sm">{lang === 'ar' ? 'أهلاً بك في فيزكس هاب، جاري توجيهك الآن...' : 'Welcome to Physics Hub, redirecting now...'}</p>
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5 font-ibm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Full Name */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-bold text-slate-700 dark:text-zinc-300 mb-2">
                  {t('fullNameLabel')}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    autoComplete="name"
                    minLength={2}
                    maxLength={120}
                    placeholder={lang === 'ar' ? 'أحمد محمد علي' : 'John Alex Smith'}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-4 py-3.5 ltr:pl-11 rtl:pr-11 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent smooth"
                  />
                  <User className="w-5 h-5 absolute top-4 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500" />
                </div>
              </div>

              {/* Email */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-bold text-slate-700 dark:text-zinc-300 mb-2">
                  {t('emailLabel')}
                </label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    placeholder="example@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    dir="ltr"
                    className="w-full px-4 py-3.5 ltr:pl-11 rtl:pr-11 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent smooth ltr:text-left rtl:text-right"
                  />
                  <User className="w-5 h-5 absolute top-4 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500" />
                </div>
              </div>

              {/* Student Phone */}
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-zinc-300 mb-2">
                  {t('studentPhoneLabel')}
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    required
                    placeholder="01012345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-4 py-3.5 ltr:pl-11 rtl:pr-11 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent smooth"
                  />
                  <Phone className="w-5 h-5 absolute top-4 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500" />
                </div>
              </div>

              {/* Parent Phone */}
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-zinc-300 mb-2">
                  {t('parentPhoneLabel')}
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    required
                    placeholder="01112345678"
                    value={parentPhone}
                    onChange={(e) => setParentPhone(e.target.value)}
                    className="w-full px-4 py-3.5 ltr:pl-11 rtl:pr-11 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent smooth"
                  />
                  <Phone className="w-5 h-5 absolute top-4 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500" />
                </div>
              </div>

              {/* Grade / Year */}
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-zinc-300 mb-2">
                  {t('gradeLabel')}
                </label>
                <div className="relative">
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="w-full px-4 py-3.5 ltr:pl-11 rtl:pr-11 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent smooth appearance-none"
                  >
                    {YEARS.map((y) => (
                      <option key={y.id} value={y.id}>
                        {lang === 'ar' ? y.titleAr : y.title} ({lang === 'ar' ? y.badgeAr : y.badge})
                      </option>
                    ))}
                  </select>
                  <GraduationCap className="w-5 h-5 absolute top-4 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* Governorate */}
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-zinc-300 mb-2">
                  {t('governorateLabel')}
                </label>
                <div className="relative">
                  <select
                    value={governorate}
                    onChange={(e) => setGovernorate(e.target.value)}
                    className="w-full px-4 py-3.5 ltr:pl-11 rtl:pr-11 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent smooth appearance-none"
                  >
                    {GOVERNORATES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <MapPin className="w-5 h-5 absolute top-4 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500 pointer-events-none" />
                </div>
              </div>

              {/* Group Selection */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-bold text-slate-700 dark:text-zinc-300 mb-2">
                  {t('studentGroup')} {t('optional')}
                </label>
                <div className="relative">
                  <select
                    value={selectedGroupId}
                    onChange={(e) => setSelectedGroupId(e.target.value)}
                    disabled={loadingGroups}
                    className="w-full px-4 py-3.5 ltr:pl-11 rtl:pr-11 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent smooth appearance-none disabled:opacity-60"
                  >
                    <option value="">{loadingGroups ? (lang === 'ar' ? 'جاري التحميل...' : 'Loading...') : (lang === 'ar' ? 'بدون مجموعة (يحددها المدرس)' : 'No group (teacher assigns)')}</option>
                    {availableGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <Layers className="w-5 h-5 absolute top-4 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500 pointer-events-none" />
                </div>
                {groupsError ? (
                  <p className="mt-1.5 text-xs font-bold text-red-600 dark:text-red-400 flex flex-wrap items-center gap-2">
                    <span>{groupsError}</span>
                    <button
                      type="button"
                      onClick={() => setGroupsReloadKey((k) => k + 1)}
                      className="underline underline-offset-2 hover:text-red-700 dark:hover:text-red-300"
                    >
                      {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                    </button>
                  </p>
                ) : availableGroups.length === 0 && !loadingGroups ? (
                  <p className="mt-1.5 text-xs text-slate-400 dark:text-zinc-500">
                    {lang === 'ar' ? 'لا توجد مجموعات متاحة لهذا الصف بعد.' : 'No groups available for this grade yet.'}
                  </p>
                ) : null}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-zinc-300 mb-2">
                  {t('passwordLabel')}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3.5 ltr:pl-11 ltr:pr-11 rtl:pr-11 rtl:pl-11 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent smooth"
                  />
                  <Lock className="w-5 h-5 absolute top-4 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500" />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute top-4 ltr:right-3.5 rtl:left-3.5 text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-200"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-zinc-300 mb-2">
                  {t('confirmPasswordLabel')}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-3.5 ltr:pl-11 rtl:pr-11 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent smooth"
                  />
                  <Lock className="w-5 h-5 absolute top-4 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500" />
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={isLoading || isSuccess}
              className="w-full py-4 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-base shadow-lg shadow-yellow-400/20 disabled:opacity-70 transition flex items-center justify-center gap-2 mt-6"
            >
              {isLoading ? (
                <div className="w-6 h-6 border-3 border-black border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>{t('registerBtn')}</span>
                  <ArrowIcon className="w-5 h-5" />
                </>
              )}
            </motion.button>
          </form>

          {/* Footer link */}
          <div className="mt-8 pt-6 border-t border-slate-200 dark:border-zinc-800 text-center text-sm font-ibm text-slate-600 dark:text-zinc-400">
            {t('alreadyHaveAccount')}{' '}
            <Link to="/login" className="font-bold text-yellow-600 dark:text-yellow-400 hover:underline">
              {t('navLogin')}
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  )
}