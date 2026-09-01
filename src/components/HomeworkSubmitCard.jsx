import { useState, useMemo } from 'react'
import {
  ClipboardList, Upload, Send, Loader2, CheckCircle2, XCircle, Award,
  Paperclip, ChevronDown, ListChecks, Target,
} from 'lucide-react'
import { useLanguage } from '../lib/i18n.jsx'
import { submitAssignment, uploadSubmissionFile } from '../lib/api'
import {
  OPTION_LETTERS, toOptionLetter, normalizeQuestion, romanNumeral,
  pickStudentAnswer, pickSubpointAnswer, withUpdatedAnswer,
} from '../lib/grading'

/**
 * One homework entry + this student's submission state and answer sheet.
 *
 * MCQ homework is marked automatically by comparing every answer with the
 * teacher's answer key (server-side when Supabase is configured), so the
 * student instantly sees total correct, total incorrect and the percentage.
 */
export default function HomeworkSubmitCard({
  assignment,
  submission,
  studentId,
  onSubmitted,
  /** Extra nodes rendered next to the score pill (e.g. status badges). */
  headerExtra = null,
  /** Extra nodes rendered at the bottom (e.g. the gated explanation video). */
  footer = null,
}) {
  const { t, lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const [showQuestions, setShowQuestions] = useState(false)
  const [content, setContent] = useState(submission?.content || '')
  const [answers, setAnswers] = useState(() => submission?.answers || {})
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  // Normalized once: stable ids, generated roman labels, per-subpoint keys.
  const questions = useMemo(
    () => (assignment.questions || []).map((q, i) => normalizeQuestion(q, i)),
    [assignment.questions]
  )
  // The RAW definitions keep the answer key. Normalization drops `answer`
  // on purpose, so the marking call must be given the original array.
  const rawQuestions = useMemo(() => assignment.questions || [], [assignment.questions])
  const isMcq = questions.length > 0
  const isGraded = submission?.status === 'graded'
  const hasSubmitted = Boolean(submission)
  const totalPoints = assignment.totalPoints || assignment.total_points || assignment.max_score || 0

  /** Every markable item = plain questions + every subpoint, counted once. */
  const itemCount = useMemo(
    () => questions.reduce((n, q) => n + (q.subpoints.length || 1), 0),
    [questions]
  )

  // Marking summary: freshly returned result first, otherwise the stored row.
  const summary = result || (submission?.correctCount != null
    ? {
        correctCount: submission.correctCount,
        incorrectCount: submission.incorrectCount,
        percentage: submission.percentage,
        earnedPoints: submission.score,
        totalPoints: submission.totalPoints || totalPoints,
        breakdown: submission.breakdown || [],
      }
    : null)

  const reviewOf = (q) => summary?.breakdown?.find(
    (b) => String(b.questionId) === String(q.id) || Number(b.number) === q.number
  )

  /**
   * The correct option letter of a marked item.
   *
   * The JS marker emits both `correctLetter` and `correctAnswer`; the SQL
   * marker (which is what a server-graded paper carries) emits only
   * `correctAnswer`. Resolve from whichever is present so the highlighted
   * key looks identical however the paper was marked.
   */
  const keyLetterOf = (row, options) =>
    toOptionLetter(row?.correctLetter || row?.correctAnswer || '', options)

  /**
   * Write exactly ONE answer. A question with subpoints stores the nested
   * shape `{ answer, subpoints: { <subpoint id>: 'C' } }`; a plain question
   * keeps storing its bare letter, so papers saved before subpoints existed
   * remain readable.
   */
  const pickAnswer = (question, subpoint, letter) =>
    setAnswers((prev) => withUpdatedAnswer(prev, question, subpoint, letter))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (isMcq) {
      const answered = questions.reduce((n, q) => {
        if (q.subpoints.length) {
          return n + q.subpoints.filter((sp) => {
            const v = pickSubpointAnswer(answers, q, sp)
            return v !== undefined && v !== null && String(v).trim() !== ''
          }).length
        }
        const v = pickStudentAnswer(answers, q)
        return n + (v !== undefined && v !== null && String(v).trim() !== '' ? 1 : 0)
      }, 0)
      if (answered === 0) {
        setError(lang === 'ar' ? 'اختر إجابة لسؤال واحد على الأقل.' : 'Answer at least one question.')
        return
      }
    } else if (!content.trim() && !file) {
      setError(lang === 'ar' ? 'اكتب إجابتك أو أرفق ملفاً.' : 'Write an answer or attach a file.')
      return
    }

    setBusy(true)
    try {
      let fileUrl = submission?.file_url || null
      if (file) fileUrl = await uploadSubmissionFile(studentId, file)

      const res = await submitAssignment({
        assignmentId: assignment.id,
        studentId,
        content: content.trim(),
        fileUrl,
        answers: isMcq ? answers : null,
        questions: rawQuestions,
      })

      if (isMcq && res && res.percentage != null) setResult(res)
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

  const dueLabel = assignment.due_date || assignment.dueDate
    ? new Date(assignment.due_date || assignment.dueDate).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB')
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
            {t('dueDate')}: <span className="font-mono">{dueLabel}</span> · {t('totalPointsLabel')}: {totalPoints}
            {questions.length > 0 && ` · ${questions.length} ${t('homeworkQuestionsCount')}`}
          </p>
        </div>

        <div className="shrink-0 flex items-center gap-2 flex-wrap justify-end">
          {headerExtra}
          {isGraded || summary ? (
            <span className="px-3 py-1.5 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center gap-1.5">
              <Award className="w-4 h-4" />
              {summary ? `${summary.earnedPoints} / ${summary.totalPoints} (${summary.percentage}%)` : `${submission.score} / ${totalPoints}`}
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

      {/* ---------- Marking summary: correct / incorrect / percentage ---------- */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
            <div className="text-[11px] font-bold text-slate-500">{t('correctAnswersLabel')}</div>
            <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{summary.correctCount ?? 0}</div>
          </div>
          <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
            <div className="text-[11px] font-bold text-slate-500">{t('incorrectAnswersLabel')}</div>
            <div className="text-lg font-extrabold text-red-600 dark:text-red-400">{summary.incorrectCount ?? 0}</div>
          </div>
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-zinc-800">
            <div className="text-[11px] font-bold text-slate-500">{t('finalScoreLabel')}</div>
            <div className="text-lg font-extrabold">{summary.earnedPoints} / {summary.totalPoints}</div>
          </div>
          <div className="p-3 rounded-2xl bg-yellow-400/10 border border-yellow-400/40">
            <div className="text-[11px] font-bold text-slate-500">{t('percentageLabel')}</div>
            <div className="text-lg font-extrabold text-yellow-600 dark:text-yellow-400">{summary.percentage ?? 0}%</div>
          </div>
        </div>
      )}

      {/* ---------- Answer sheet (MCQ) ---------- */}
      {isMcq && (
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
          <button
            onClick={() => setShowQuestions((v) => !v)}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-black/40 text-xs font-bold flex items-center justify-between gap-2 hover:bg-slate-100 dark:hover:bg-zinc-800/50 transition"
          >
            <span className="flex items-center gap-1.5">
              <ListChecks className="w-4 h-4 text-yellow-500" />
              {isGraded || summary ? t('answerReviewTitle') : t('answerSheetTitle')} ({questions.length})
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showQuestions ? 'rotate-180' : ''}`} />
          </button>

          {showQuestions && (
            <div className="p-4 space-y-4 bg-white dark:bg-zinc-900">
              {questions.map((q) => {
                const reviewed = reviewOf(q)
                const revealKey = Boolean(reviewed) || isGraded

                return (
                  <div key={q.id} className="space-y-1.5">
                    <p className="text-xs font-bold flex items-start gap-1.5">
                      <span className="text-yellow-500 shrink-0">{q.number}.</span>
                      <span className="flex-1">{q.question}</span>
                      <span className="text-[10px] text-slate-400 font-mono shrink-0">
                        ({reviewed?.points ?? q.points} {t('pointsLabel')})
                      </span>
                      {reviewed && (
                        reviewed.isCorrect
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          : <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                      )}
                    </p>

                    {/* ---- Plain MCQ: one answer for the whole question ---- */}
                    {!q.subpoints.length && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {(q.options || []).map((opt, oi) => {
                          const letter = OPTION_LETTERS[oi]
                          const chosen = toOptionLetter(pickStudentAnswer(answers, q), q.options)
                          const isKey = revealKey && letter !== '' && letter === keyLetterOf(reviewed, q.options)
                          const isChosen = chosen === letter
                          const wrongChoice = revealKey && isChosen && !isKey

                          return (
                            <button
                              key={oi}
                              type="button"
                              disabled={isGraded || busy}
                              onClick={() => pickAnswer(q, null, letter)}
                              className={`px-3 py-2 rounded-lg text-[11px] font-bold border text-start transition disabled:cursor-not-allowed ${
                                isKey
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                                  : wrongChoice
                                    ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300'
                                    : isChosen
                                      ? 'bg-yellow-400 border-yellow-500 text-black'
                                      : 'bg-slate-50 dark:bg-black/40 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-yellow-400/60'
                              }`}
                            >
                              {opt}
                              {isKey && ' ✓'}
                              {wrongChoice && ' ✕'}
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* ---- Nested subpoints: each one its own MCQ ---- */}
                    {q.subpoints.length > 0 && (
                      <div className="ltr:pl-3 rtl:pr-3 sm:ltr:pl-4 sm:rtl:pr-4 space-y-2.5 mt-2 border-s-2 border-purple-200 dark:border-purple-900">
                        {q.subpoints.map((sp) => {
                          const spReview = reviewed?.subpoints?.find(
                            (s) => String(s.subpointId) === String(sp.id)
                          )
                          const chosen = toOptionLetter(pickSubpointAnswer(answers, q, sp), sp.options)

                          return (
                            <div
                              key={sp.id}
                              className="p-2.5 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/50 dark:border-purple-800/50 space-y-1.5"
                            >
                              <p className="text-[11px] font-bold flex items-start gap-1.5">
                                {/* dir="ltr" keeps "ii"/"iii" from being visually
                                    reordered by an RTL paragraph. */}
                                <span className="text-purple-600 dark:text-purple-300 shrink-0 font-mono" dir="ltr">
                                  {sp.label || romanNumeral(sp.number)}
                                </span>
                                <span className="flex-1">{sp.question}</span>
                                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                  ({spReview?.points ?? sp.points} {t('pointsLabel')})
                                </span>
                                {spReview && (
                                  spReview.isCorrect
                                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                    : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                )}
                              </p>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                {(sp.options || []).map((opt, oi) => {
                                  const letter = OPTION_LETTERS[oi]
                                  const isKey = revealKey && letter !== '' && letter === keyLetterOf(spReview, sp.options)
                                  const isChosen = chosen === letter
                                  const wrongChoice = revealKey && isChosen && !isKey

                                  return (
                                    <button
                                      key={oi}
                                      type="button"
                                      disabled={isGraded || busy}
                                      onClick={() => pickAnswer(q, sp, letter)}
                                      className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border text-start transition disabled:cursor-not-allowed ${
                                        isKey
                                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                                          : wrongChoice
                                            ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300'
                                            : isChosen
                                              ? 'bg-yellow-400 border-yellow-500 text-black'
                                              : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-purple-400/60'
                                      }`}
                                    >
                                      {opt}
                                      {isKey && ' ✓'}
                                      {wrongChoice && ' ✕'}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}

              {!isGraded && (
                <button
                  onClick={handleSubmit}
                  disabled={busy}
                  className="w-full py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-sm flex items-center justify-center gap-2 transition"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                  <span>{busy ? t('submitting') : t('submitAnswersAndGrade')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {(assignment.attachment_url || assignment.attachmentUrl) && (
        <a
          href={assignment.attachment_url || assignment.attachmentUrl} target="_blank" rel="noreferrer"
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

      {error && <p className="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}

      {/* ---------- Free-text / file submission (non-MCQ homework) ---------- */}
      {!isGraded && (
        <>
          {isMcq ? (
            !showQuestions && (
              <button
                onClick={() => setShowQuestions(true)}
                className="px-5 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-sm flex items-center gap-2 transition"
              >
                <Send className="w-4 h-4" />
                <span>{hasSubmitted ? t('resubmit') : t('openAnswerSheet')}</span>
              </button>
            )
          ) : !open ? (
            <button
              onClick={() => setOpen(true)}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-sm flex items-center justify-center gap-2 transition"
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
                  <Upload className="w-4 h-4 shrink-0" />
                  <span className="truncate">{file ? file.name : t('attachFile')}</span>
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3">
                <button
                  type="submit" disabled={busy}
                  className="px-6 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-bold text-sm flex items-center justify-center gap-2 transition"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>{busy ? t('submitting') : t('submitAssignment')}</span>
                </button>
                <button
                  type="button" onClick={() => setOpen(false)}
                  className="px-6 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm flex items-center justify-center"
                >
                  {t('cancel')}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {footer}
    </div>
  )
}
