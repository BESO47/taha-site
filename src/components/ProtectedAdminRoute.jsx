import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ProtectedAdminRoute({ children }) {
    const [status, setStatus] = useState('checking') // 'checking' | 'authorized' | 'denied'

    useEffect(() => {
        checkAdminAccess()

        // لو الـ session اتلغى في تاب تاني (مثلاً بعد logout)، حدّث الحالة هنا كمان
        const { data: listener } = supabase.auth.onAuthStateChange(() => {
            checkAdminAccess()
        })

        return () => listener.subscription.unsubscribe()
    }, [])

    const checkAdminAccess = async () => {
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
            setStatus('denied')
            return
        }

        // نتحقق من role الحقيقي في جدول profiles، مش من أي حاجة في المتصفح
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .single()

        if (error || !profile || profile.role !== 'admin') {
            setStatus('denied')
            return
        }

        setStatus('authorized')
    }

    if (status === 'checking') {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
            </div>
        )
    }

    if (status === 'denied') {
        return <Navigate to="/login" replace />
    }

    return children
}