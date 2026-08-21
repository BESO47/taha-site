import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'

import { LanguageProvider } from './lib/i18n.jsx'
import { AuthProvider } from './lib/auth.jsx'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import WhatsAppButton from './components/WhatsAppButton.jsx'
import FloatingPhysicsBg from './components/FloatingPhysicsBg.jsx'
import ProtectedAdminRoute from './components/ProtectedAdminRoute.jsx'
import ProtectedStudentRoute from './components/ProtectedStudentRoute.jsx'

// Route-level splitting keeps the large admin tools and data clients out of
// the public landing-page bundle. Vite emits one cached chunk per route.
const HomePage = lazy(() => import('./pages/HomePage.jsx'))
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'))
const RegisterPage = lazy(() => import('./pages/RegisterPage.jsx'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage.jsx'))
const YearDetailPage = lazy(() => import('./pages/YearDetailPage.jsx'))
const LessonDetailPage = lazy(() => import('./pages/LessonDetailPage.jsx'))
const PastExamsPage = lazy(() => import('./pages/PastExamsPage.jsx'))
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage.jsx'))
const StudentProfilePage = lazy(() => import('./pages/StudentProfilePage.jsx'))
const HomeworkPage = lazy(() => import('./pages/HomeworkPage.jsx'))
const LessonsPage = lazy(() => import('./pages/LessonsPage.jsx'))

function RouteLoader() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-live="polite">
      <Loader2 className="w-8 h-8 animate-spin text-yellow-500" aria-hidden="true" />
      <span className="sr-only">Loading</span>
    </div>
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.25 }}
        className="w-full flex-1"
      >
        <Suspense fallback={<RouteLoader />}>
          <Routes location={location}>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/years/:yearId" element={<YearDetailPage />} />
            <Route path="/lessons" element={<LessonsPage />} />
            <Route path="/lessons/:lessonId" element={<LessonDetailPage />} />
            <Route path="/exams" element={<PastExamsPage />} />
            <Route
              path="/profile"
              element={
                <ProtectedStudentRoute>
                  <StudentProfilePage />
                </ProtectedStudentRoute>
              }
            />
            <Route
              path="/homework"
              element={
                <ProtectedStudentRoute>
                  <HomeworkPage />
                </ProtectedStudentRoute>
              }
            />
            <Route path="/videos" element={<Navigate to="/lessons" replace />} />
            <Route
              path="/admin"
              element={
                <ProtectedAdminRoute>
                  <AdminDashboardPage />
                </ProtectedAdminRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
          <div className="flex flex-col justify-between h-full w-full relative min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-zinc-100 smooth font-ibm selection:bg-yellow-400 selection:text-black">
            <FloatingPhysicsBg />
            <Navbar />
            <AnimatedRoutes />
            <Footer />
            <WhatsAppButton />
          </div>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  )
}
