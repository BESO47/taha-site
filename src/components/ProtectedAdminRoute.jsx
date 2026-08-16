import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'

/** Admin-only gate. The real enforcement is RLS; this just avoids a broken UI. */
export default function ProtectedAdminRoute({ children }) {
  const { loading, session, isAdmin } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
      </div>
    )
  }

  if (!session || !isAdmin) return <Navigate to="/login" replace />

  return children
}
