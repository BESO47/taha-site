import { useState } from 'react'
import { ClipboardList, Upload, Send, Loader2, CheckCircle2, Award, Paperclip } from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'
import { submitAssignment, uploadSubmissionFile } from '../lib/api'

/** One assignment + this student's submission state and submit form. */
export default function AssignmentSubmitCard({ assignment, submission, studentId, onSubmitted }) {
  const { t, lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState(submission?.content || '')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const isGraded = submission?.status === 'graded'
  const hasSubmitted = Boolean(submission)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!content.trim() && !file) {
      setError(lang === 'ar' ? 'اكتب إجابتك أو أرفق ملفاً.' : 'Write an answer or attach a file.')
      return
    }

    setBusy(true)
    try {
      let fileUrl = submission?.file_url || null
      if (file) fileUrl = await uploadSubmissionFile(studentId, file)

      await submitAssignment({
        assignmentId: assignment.id,
        studentId,
        content: content.trim(),
        fileUrl,
      })

      setMsg(t('submitSuccess'))
      setFile(null)
      setOpen(false)
      setTimeout(() => setMsg(''), 4000)
      onSubmitted?.()
    } catch (err) {
      console.error(err)
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const dueLabel = assignment.due_date
    ? new Date(assignment.due_date).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB')
    : t('noDueDate')

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-yellow-500 shrink-0" />
            <h3 className="font-bold text-lg">{assignment.title}</h3>
          </div>
          {assignment.description && (
            <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">{assignment.description}</p>
          )}
          <p className="text-xs text-slate-500">
            {t('dueDate')}: <span className="font-mono">{dueLabel}</span> · {t('maxScore')}: {assignment.max_score}
          </p>
        </div>

        <div className="shrink-0">
          {isGraded ? (
            <span className="px-3 py-1.5 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center gap-1.5">
              <Award className="w-4 h-4" />
              {submission.score} / {assignment.max_score}
            </span>
          ) : hasSubmitted ? (
            <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              {t('submitted')}
            </span>
          ) : (
            <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400">
              {t('notSubmitted')}
            </span>
          )}
        </div>
      </div>

      {assignment.attachment_url && (
        <a
          href={assignment.attachment_url} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-yellow-600 dark:text-yellow-400 hover:underline"
        >
          <Paperclip className="w-3.5 h-3.5" />
          {t('viewAttachment')}
        </a>
      )}

      {isGraded && submission.feedback && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
          <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 mb-1">{t('teacherFeedback')}</p>
          <p className="text-sm text-emerald-800 dark:text-emerald-200">{submission.feedback}</p>
        </div>
      )}

      {msg && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-sm font-bold text-center">
          {msg}
        </div>
      )}

      {/* Graded work is locked — matches the RLS policy on submissions */}
      {!isGraded && (
        <>
          {!open ? (
            <button
              onClick={() => setOpen(true)}
              className="px-5 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-sm flex items-center gap-2 transition"
            >
              <Send className="w-4 h-4" />
              <span>{hasSubmitted ? t('resubmit') : t('submitAssignment')}</span>
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3 pt-2 border-t border-slate-200 dark:border-zinc-800">
              <div>
                <label className="block text-xs font-bold mb-1.5">{t('yourAnswer')}</label>
                <textarea
                  rows={4} value={content} onChange={(e) => setContent(e.target.value)}
                  placeholder={t('answerPlaceholder')}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5">{t('attachFile')}</label>
                <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 cursor-pointer hover:border-yellow-400 transition text-sm text-slate-600 dark:text-zinc-400">
                  <Upload className="w-4 h-4" />
                  <span>{file ? file.name : t('attachFile')}</span>
                  <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </label>
              </div>

              {error && <p className="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex gap-3">
                <button
                  type="submit" disabled={busy}
                  className="px-6 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-bold text-sm flex items-center gap-2"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>{busy ? t('submitting') : t('submitAssignment')}</span>
                </button>
                <button
                  type="button" onClick={() => setOpen(false)}
                  className="px-6 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm"
                >
                  {t('cancel')}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  )
}
