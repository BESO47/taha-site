import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

import { LanguageProvider } from './lib/i18n.jsx'
import { AuthProvider } from './lib/auth.jsx'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import WhatsAppButton from './components/WhatsAppButton.jsx'
import FloatingPhysicsBg from './components/FloatingPhysicsBg.jsx'
import ProtectedAdminRoute from './components/ProtectedAdminRoute.jsx'
import ProtectedStudentRoute from './components/ProtectedStudentRoute.jsx'

import HomePage from './pages/HomePage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import YearDetailPage from './pages/YearDetailPage.jsx'
import LessonDetailPage from './pages/LessonDetailPage.jsx'
import PastExamsPage from './pages/PastExamsPage.jsx'
import AdminDashboardPage from './pages/AdminDashboardPage.jsx'
import StudentProfilePage from './pages/StudentProfilePage.jsx'
import VideosPage from './pages/VideosPage.jsx'

// Helper component to scroll to top on route change
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
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/years/:yearId" element={<YearDetailPage />} />
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
            path="/videos"
            element={
              <ProtectedStudentRoute>
                <VideosPage />
              </ProtectedStudentRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedAdminRoute>
                <AdminDashboardPage />
              </ProtectedAdminRoute>
            }
          />
          {/* Catch all fallback */}
          <Route path="*" element={<HomePage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

export default function App() {
  // Global Anti-Right-Click & Anti-DevTools keyboard shortcuts lock
  useEffect(() => {
    const handleGlobalContextMenu = (e) => {
      e.preventDefault()
      e.stopPropagation()
      return false
    }

    const handleGlobalKeyDown = (e) => {
      const key = e.key
      const code = e.keyCode || e.which

      // Block F12, F11
      if (code === 123 || key === 'F12' || code === 122 || key === 'F11') {
        e.preventDefault()
        e.stopPropagation()
        return false
      }

      // Block Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
      if (
        e.ctrlKey &&
        e.shiftKey &&
        (key === 'I' || key === 'i' || key === 'J' || key === 'j' || key === 'C' || key === 'c')
      ) {
        e.preventDefault()
        e.stopPropagation()
        return false
      }

      // Block Ctrl+U (View Source), Ctrl+S (Save Page)
      if (e.ctrlKey && (key === 'u' || key === 'U' || key === 's' || key === 'S')) {
        e.preventDefault()
        e.stopPropagation()
        return false
      }
    }

    window.addEventListener('contextmenu', handleGlobalContextMenu, true)
    document.addEventListener('contextmenu', handleGlobalContextMenu, true)
    window.addEventListener('keydown', handleGlobalKeyDown, true)
    document.addEventListener('keydown', handleGlobalKeyDown, true)

    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu, true)
      document.removeEventListener('contextmenu', handleGlobalContextMenu, true)
      window.removeEventListener('keydown', handleGlobalKeyDown, true)
      document.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [])

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