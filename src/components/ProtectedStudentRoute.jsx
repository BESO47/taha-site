import { Navigate } from 'react-router-dom'
import { Loader2, AlertTriangle } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { useLanguage } from '../lib/i18n.jsx'

/** Any signed-in user. Suspended accounts get a clear message instead of data. */
export default function ProtectedStudentRoute({ children }) {
  const { loading, session, profile, isActive } = useAuth()
  const { lang } = useLanguage()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  if (profile && !isActive) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4 text-center px-4 font-ibm">
        <AlertTriangle className="w-14 h-14 text-red-500" />
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">
          {lang === 'ar' ? 'حسابك موقوف حالياً' : 'Your account is suspended'}
        </h2>
        <p className="text-sm text-slate-500 max-w-md">
          {lang === 'ar'
            ? 'يرجى التواصل مع المدرس لإعادة تفعيل حسابك والوصول إلى الدروس والواجبات.'
            : 'Please contact your teacher to reactivate your account and regain access.'}
        </p>
      </div>
    )
  }

  return children
}
