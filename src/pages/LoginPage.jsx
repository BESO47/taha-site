import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, Sparkles, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n.jsx'

export default function LoginPage() {
  const { lang, t } = useLanguage()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const ArrowIcon = lang === 'ar' ? ArrowLeft : ArrowRight

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    if (!email || !password) {
      setErrorMsg(lang === 'ar' ? 'يرجى إدخال جميع البيانات المطلوبة' : 'Please enter all required fields')
      return
    }

    setIsLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        if (error.message?.toLowerCase().includes('invalid login credentials')) {
          setErrorMsg(lang === 'ar' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' : 'Invalid email or password.')
        } else if (error.message?.toLowerCase().includes('email not confirmed')) {
          setErrorMsg(lang === 'ar' ? 'يرجى تفعيل البريد الإلكتروني أولاً.' : 'Please confirm your email address first.')
        } else {
          setErrorMsg(lang === 'ar' ? 'حدث خطأ أثناء تسجيل الدخول، حاول مجدداً.' : 'An error occurred during login. Please try again.')
        }
        setIsLoading(false)
        return
      }

      if (!data.session) {
        setErrorMsg(lang === 'ar' ? 'حدث خطأ غير متوقع، حاول مجدداً.' : 'An unexpected error occurred. Please try again.')
        setIsLoading(false)
        return
      }

      setIsLoading(false)
      setSuccessMsg(lang === 'ar' ? 'تم تسجيل الدخول بنجاح! جاري توجيهك...' : 'Login successful! Redirecting...')

      setTimeout(() => {
        navigate('/')
      }, 1200)
    } catch (err) {
      console.error(err)
      setErrorMsg(lang === 'ar' ? 'حدث خطأ غير متوقع، حاول مجدداً.' : 'An unexpected error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 relative overflow-hidden font-ibm bg-slate-50 dark:bg-black">
      {/* Background glow */}
      <div className="absolute top-1/4 ltr:-right-20 rtl:-left-20 w-80 h-80 bg-yellow-400/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 ltr:-left-20 rtl:-right-20 w-80 h-80 bg-yellow-500/10 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-md z-10"
      >
        <div className="bg-white dark:bg-zinc-900 backdrop-blur-md rounded-3xl p-8 sm:p-10 shadow-2xl border border-slate-200 dark:border-zinc-800 relative overflow-hidden">
          {/* Top accent bar */}
          <div className="absolute top-0 inset-x-0 h-2 bg-yellow-400" />

          {/* Header */}
          <div className="text-center space-y-3 mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 mb-2 shadow-inner border border-yellow-400/30">
              <Zap className="w-8 h-8 fill-current" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white font-outfit">
              {t('loginTitle')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-zinc-400 font-ibm">
              {t('loginSubtitle')}
            </p>
          </div>

          {/* Alert messages */}
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-bold text-center"
            >
              {errorMsg}
            </motion.div>
          )}

          {successMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-6 p-4 rounded-xl bg-yellow-400/20 border border-yellow-400/40 text-yellow-800 dark:text-yellow-300 text-sm font-bold text-center flex items-center justify-center gap-2"
            >
              <Sparkles className="w-5 h-5 text-yellow-500" />
              {successMsg}
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5 font-ibm">
            {/* Email input */}
            <div>
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
                <Mail className="w-5 h-5 absolute top-4 ltr:left-3.5 rtl:right-3.5 text-slate-400 dark:text-zinc-500" />
              </div>
            </div>

            {/* Password input */}
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
                  className="absolute top-4 ltr:right-3.5 rtl:left-3.5 text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-200 transition"
                  aria-label="Toggle Password Visibility"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Remember me & Forgot Password */}
            <div className="flex items-center justify-between text-sm pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-slate-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  defaultChecked
                  className="w-4 h-4 rounded border-slate-300 dark:border-zinc-700 text-yellow-500 focus:ring-yellow-400"
                />
                <span>{t('rememberMe')}</span>
              </label>
              <a href="#" className="text-yellow-600 dark:text-yellow-400 hover:underline font-bold text-xs">
                {t('forgotPassword')}
              </a>
            </div>

            {/* Submit button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={isLoading}
              className="w-full py-4 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-base shadow-lg shadow-yellow-400/20 disabled:opacity-70 transition flex items-center justify-center gap-2 mt-4"
            >
              {isLoading ? (
                <div className="w-6 h-6 border-3 border-black border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>{t('loginBtn')}</span>
                  <ArrowIcon className="w-5 h-5" />
                </>
              )}
            </motion.button>
          </form>

          {/* Footer note */}
          <div className="mt-8 pt-6 border-t border-slate-200 dark:border-zinc-800 text-center text-sm font-ibm text-slate-600 dark:text-zinc-400">
            {t('noAccount')}{' '}
            <Link to="/register" className="font-bold text-yellow-600 dark:text-yellow-400 hover:underline">
              {t('registerLink')}
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  )
}