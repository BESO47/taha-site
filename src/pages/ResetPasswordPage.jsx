import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n.jsx'

export default function ResetPasswordPage() {
  const { lang } = useLanguage()
  const navigate = useNavigate()
  const [hasRecoverySession, setHasRecoverySession] = useState(false)
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setHasRecoverySession(Boolean(data.session))
        setChecking(false)
      }
    })
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || session) setHasRecoverySession(true)
      setChecking(false)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const requestReset = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const redirectTo = `${window.location.origin}/reset-password`
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
    setBusy(false)
    if (resetError) {
      setError(lang === 'ar' ? 'تعذر إرسال رابط الاستعادة. حاول مرة أخرى لاحقاً.' : 'Could not send the recovery link. Please try again later.')
      return
    }
    // Deliberately use the same response whether or not an account exists.
    setMessage(lang === 'ar' ? 'إذا كان البريد مسجلاً فسيصلك رابط الاستعادة خلال دقائق.' : 'If that address is registered, a recovery link will arrive shortly.')
  }

  const updatePassword = async (event) => {
    event.preventDefault()
    setError('')
    if (password.length < 8) {
      setError(lang === 'ar' ? 'استخدم 8 أحرف على الأقل.' : 'Use at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError(lang === 'ar' ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.')
      return
    }

    setBusy(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) {
      setError(lang === 'ar' ? 'انتهت صلاحية الرابط أو تعذر تحديث كلمة المرور.' : 'The link expired or the password could not be updated.')
      return
    }
    setMessage(lang === 'ar' ? 'تم تحديث كلمة المرور بنجاح.' : 'Password updated successfully.')
    setTimeout(() => navigate('/login', { replace: true }), 1200)
  }

  return (
    <main className="min-h-[75vh] flex items-center justify-center px-4 py-12 font-ibm">
      <section className="w-full max-w-md rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-7 sm:p-9 shadow-xl space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 flex items-center justify-center">
            {hasRecoverySession ? <ShieldCheck className="w-7 h-7" /> : <KeyRound className="w-7 h-7" />}
          </div>
          <h1 className="text-2xl font-extrabold font-outfit">
            {hasRecoverySession
              ? (lang === 'ar' ? 'تعيين كلمة مرور جديدة' : 'Set a new password')
              : (lang === 'ar' ? 'استعادة كلمة المرور' : 'Reset your password')}
          </h1>
        </div>

        {checking ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
        ) : hasRecoverySession ? (
          <form onSubmit={updatePassword} className="space-y-4">
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={lang === 'ar' ? 'كلمة المرور الجديدة' : 'New password'}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black"
            />
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={lang === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm password'}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black"
            />
            <button disabled={busy} className="w-full py-3 rounded-xl bg-yellow-400 text-black font-extrabold disabled:opacity-60">
              {busy ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (lang === 'ar' ? 'حفظ كلمة المرور' : 'Save password')}
            </button>
          </form>
        ) : (
          <form onSubmit={requestReset} className="space-y-4">
            <div className="relative">
              <Mail className="absolute top-3.5 ltr:left-3 rtl:right-3 w-4 h-4 text-slate-400" />
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="example@gmail.com"
                dir="ltr"
                className="w-full px-10 py-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-black"
              />
            </div>
            <button disabled={busy} className="w-full py-3 rounded-xl bg-yellow-400 text-black font-extrabold disabled:opacity-60">
              {busy ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (lang === 'ar' ? 'إرسال رابط الاستعادة' : 'Send recovery link')}
            </button>
          </form>
        )}

        {error && <p role="alert" className="text-sm font-bold text-red-600 text-center">{error}</p>}
        {message && <p role="status" className="text-sm font-bold text-emerald-600 text-center">{message}</p>}
        <Link to="/login" className="block text-center text-sm font-bold text-yellow-600 dark:text-yellow-400 hover:underline">
          {lang === 'ar' ? 'العودة لتسجيل الدخول' : 'Back to sign in'}
        </Link>
      </section>
    </main>
  )
}
