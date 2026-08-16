import { useState } from 'react'
import { MessageCircle, Loader2, Users, User } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'
import {
  fetchStudentAnalytics, fetchGradesForStudent,
  fetchAttendanceForStudent, fetchAssignments, fetchSubmissionsForStudent,
} from '../lib/api'
import { buildReportMessage, sendReport, isWebhookConfigured } from '../lib/whatsapp'

/**
 * Gathers a student's attendance + grades + outstanding homework and pushes
 * the summary to WhatsApp (wa.me deep link, or webhook when configured).
 */
export default function WhatsAppReportButton({ student, compact = false }) {
  const { t, lang } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSend = async (target) => {
    const phone = target === 'parent' ? student.parent_phone : student.phone
    if (!phone) {
      alert(lang === 'ar' ? 'لا يوجد رقم هاتف مسجل لهذا المستلم.' : 'No phone number saved for this recipient.')
      return
    }

    setBusy(true)
    setMenuOpen(false)
    try {
      const [analytics, grades, attendance, assignments, submissions] = await Promise.all([
        fetchStudentAnalytics(student.id),
        fetchGradesForStudent(student.id),
        fetchAttendanceForStudent(student.id),
        fetchAssignments({ yearId: student.year_id }),
        fetchSubmissionsForStudent(student.id),
      ])

      const submittedIds = new Set(submissions.map((s) => s.assignment_id))
      const pending = assignments.filter((a) => !submittedIds.has(a.id))

      const message = buildReportMessage({
        studentName: student.full_name,
        analytics: analytics || {},
        recentGrades: grades,
        recentAttendance: attendance,
        pendingAssignments: pending,
        lang,
      })

      await sendReport(phone, message, { studentId: student.id, target })
      if (isWebhookConfigured()) alert(t('reportSent'))
    } catch (err) {
      console.error(err)
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        disabled={busy}
        className={`rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold flex items-center gap-2 transition ${
          compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'
        }`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
        <span>{t('sendReport')}</span>
      </button>

      {menuOpen && !busy && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute z-20 mt-2 w-52 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 shadow-2xl p-2 ltr:right-0 rtl:left-0">
            <button
              onClick={() => handleSend('student')}
              className="w-full px-3 py-2.5 rounded-xl text-xs font-bold text-start hover:bg-green-50 dark:hover:bg-green-950/40 flex items-center gap-2 transition"
            >
              <User className="w-4 h-4 text-green-600" />
              <span>{t('sendToStudent')}</span>
            </button>
            <button
              onClick={() => handleSend('parent')}
              className="w-full px-3 py-2.5 rounded-xl text-xs font-bold text-start hover:bg-green-50 dark:hover:bg-green-950/40 flex items-center gap-2 transition"
            >
              <Users className="w-4 h-4 text-green-600" />
              <span>{t('sendToParent')}</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
