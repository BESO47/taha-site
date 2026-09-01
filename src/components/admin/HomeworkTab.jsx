import { useState, useEffect, useCallback } from 'react'
import {
  ClipboardList, Check, Save, Eye, Loader2, Key, Users, Unlock, Lock,
  Plus, Trash2, Award, X, Sparkles, FileText, Pencil, ListChecks, CalendarClock,
  Send, AlertCircle, Target, RefreshCw, CheckCircle2, XCircle, PlayCircle,
  ChevronUp, ChevronDown, History, ShieldAlert,
} from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/catalog'
import { fetchLessonsFromSupabase, updateLessonInSupabase } from '../../lib/supabase'
import {
  fetchStudents, fetchHomeworkSubmissionsForLesson, fetchGroups,
  fetchHomeworkEntries, createHomeworkEntry, updateHomeworkEntry, deleteHomeworkEntry,
  fetchSubmissionsForAssignment, upsertHomeworkSubmissionGrade, computeHomeworkTotalPoints,
  autoGradeAssignmentSubmissions, regradeLessonSubmissions,
  validateHomeworkQuestions, adminUpdateSubmissionAnswer, fetchSubmissionAnswerEdits,
} from '../../lib/api'
import {
  gradeSubmissionAgainstKey, summarizeGrades, romanNumeral, OPTION_LETTERS,
  buildReviewBreakdown,
} from '../../lib/grading'
import GroupFilterSelect, { getInitialGroupFilter } from './GroupFilterSelect.jsx'

/* ------------------------------------------------------------------ */
/* Editor helpers                                                      */
/* ------------------------------------------------------------------ */
const LETTERS = ['A', 'B', 'C', 'D']

const blankOptions = () => LETTERS.map((l) => `${l}) `)

const newQuestion = () => ({
  id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  question: '',
  options: blankOptions(),
  answer: 'A',
  points: 1,
  subpoints: [],
})

/**
 * A subpoint is ALWAYS a complete MCQ — text, four editable options,
 * exactly one correct answer and its own points. There is deliberately no
 * "text only" subpoint: the marking engine grades every subpoint against
 * its own key, so a keyless subpoint would be unmarkable.
 *
 * The visible label (i, ii, iii…) is NOT stored: it is derived from the
 * subpoint's position, so deleting or re-ordering re-numbers automatically.
 */
const newSubpoint = () => ({
  id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  question: '',
  options: blankOptions(),
  answer: '',
  points: 1,
})

const EMPTY_FORM = () => ({
  title: '',
  description: '',
  yearId: '5',
  branch: '',
  dueDate: '',
  attachmentUrl: '',
  explanationVideoUrl: '',
  explanationVideoTitle: '',
  isPublished: true,
  groupName: '',
  groupIds: [],
  questions: [newQuestion()],
})

const padOptions = (opts) => {
  const list = Array.isArray(opts) ? [...opts] : []
  while (list.length < 4) list.push(`${LETTERS[list.length]}) `)
  return list.slice(0, 4).map((o) => (o == null ? '' : String(o)))
}

/** Read a stored subpoint: `question` is canonical, `text` is the legacy name. */
const toSubpointForm = (sp, i) => ({
  id: sp.id || `sp_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
  question: sp.question ?? sp.text ?? '',
  options: padOptions(sp.options),
  answer: String(sp.answer ?? sp.correctAnswer ?? '') || '',
  points: Number(sp.points) > 0 ? Number(sp.points) : 1,
})

const entryToForm = (e) => ({
  title: e.title || '',
  description: e.description || '',
  yearId: e.yearId || '5',
  branch: e.branch || '',
  dueDate: e.dueDate ? String(e.dueDate).slice(0, 16) : '',
  attachmentUrl: e.attachmentUrl || '',
  explanationVideoUrl: e.explanationVideoUrl || '',
  explanationVideoTitle: e.explanationVideoTitle || '',
  isPublished: e.isPublished !== false,
  groupName: e.groupName || '',
  groupIds: e.groupIds || [],
  questions: (e.questions && e.questions.length ? e.questions : []).map((q) => {
    const subpoints = Array.isArray(q.subpoints) ? q.subpoints.filter(Boolean) : []
    return {
      id: q.id || `q_${Math.random().toString(36).slice(2, 8)}`,
      question: q.question ?? q.text ?? '',
      options: padOptions(q.options),
      answer: String(q.answer ?? q.correctAnswer ?? '') || 'A',
      points: Number(q.points) > 0 ? Number(q.points) : 1,
      subpoints: subpoints.map(toSubpointForm),
    }
  }),
})

const STATUS_PILL = {
  graded: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  submitted: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  not_submitted: 'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400',
}

/**
 * Roman label of a subpoint inside a graded breakdown, so the audit trail
 * can name the item it refers to ("ii") instead of showing a raw id.
 */
const subpointLabelFor = (breakdown = [], questionId, subpointId) => {
  const q = (breakdown || []).find((b) => String(b.questionId) === String(questionId))
  const sp = (q?.subpoints || []).find((s) => String(s.subpointId) === String(subpointId))
  return sp?.label || romanNumeral(sp?.number) || subpointId
}

/* ================================================================== */
/*  Unified Homework module — merged Assignments + Homework            */
/* ================================================================== */
export default function HomeworkTab() {
  const { t, lang } = useLanguage()

  /* ----- Universal group filter (shared across all admin modules) ----- */
  const [groupId, setGroupId] = useState(() => getInitialGroupFilter())
  const [groups, setGroups] = useState([])
  const selectedGroupName = groups.find((g) => g.id === groupId)?.name || null

  /* ----- Section switcher: Entries CRUD  |  Lesson gating ----- */
  const [section, setSection] = useState('entries')

  /* ----- Homework entries CRUD state ----- */
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  const [editor, setEditor] = useState(null) // null | 'create' | entry
  const [form, setForm] = useState(EMPTY_FORM())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  /* ----- Submissions & grading state ----- */
  const [viewingEntry, setViewingEntry] = useState(null)
  const [students, setStudents] = useState([])
  const [subs, setSubs] = useState([])
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [gradeMsg, setGradeMsg] = useState('')
  const [autoGrading, setAutoGrading] = useState(false)
  const [regrading, setRegrading] = useState(false)
  const [reviewSub, setReviewSub] = useState(null)

  /* ----- Admin answer editing (re-grades server-side, writes an audit row) ----- */
  // { student, sub, questionId, questionNumber, subpointId, label, question,
  //   options, currentAnswer, correctAnswer, points } | null
  const [editAnswer, setEditAnswer] = useState(null)
  const [editChoice, setEditChoice] = useState('')
  const [confirmEdit, setConfirmEdit] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [auditRows, setAuditRows] = useState([])
  const [showAudit, setShowAudit] = useState(false)

  /* ----- Lesson gating state (kept from the legacy HomeworkTab) ----- */
  const [lessons, setLessons] = useState([])
  const [selectedLessonId, setSelectedLessonId] = useState('')
  const [modelAnswersMap, setModelAnswersMap] = useState({})
  const [questionCount, setQuestionCount] = useState(5)
  const [homeworkQuestionsList, setHomeworkQuestionsList] = useState([])
  const [savingModel, setSavingModel] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [lessonSubs, setLessonSubs] = useState([])
  const [loadingLessonSubs, setLoadingLessonSubs] = useState(false)
  const [viewingSubmission, setViewingSubmission] = useState(null)

  const loadBaseData = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [allEntries, allGroups, allStudents] = await Promise.all([
        fetchHomeworkEntries(),
        fetchGroups(),
        fetchStudents(),
      ])
      setEntries(allEntries)
      setGroups(allGroups)
      setStudents(allStudents)
    } catch (err) {
      // A backend failure must be visible: an empty homework list that is
      // really an RLS/migration error would be read as "nothing to do".
      console.error('Failed to load homework module data:', err)
      setLoadError(err.message || 'Unable to load the homework module.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadBaseData() }, [loadBaseData])

  /* ---------- Entries: create / edit / delete ---------- */
  const handleSaveEntry = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return

    // Nothing incomplete may be persisted: a subpoint without its four
    // options or without a correct answer could never be marked.
    const problem = validateHomeworkQuestions(form.questions, lang)
    if (problem) {
      setFormError(problem)
      return
    }
    setFormError('')

    setSaving(true)
    try {
      const payload = {
        ...form,
        // api.js canonicalizes; this keeps the shape identical offline too.
        questions: form.questions.map((q) => {
          const subs = (q.subpoints || []).filter(Boolean)
          const base = {
            id: q.id,
            question: String(q.question ?? '').trim(),
            points: Number(q.points) || 1,
          }
          if (subs.length) {
            base.subpoints = subs.map((sp) => ({
              id: sp.id,
              question: String(sp.question ?? '').trim(),
              options: padOptions(sp.options),
              answer: sp.answer,
              points: Number(sp.points) || 1,
            }))
          } else {
            base.options = padOptions(q.options)
            base.answer = q.answer
          }
          return base
        }),
      }
      if (editor === 'create') await createHomeworkEntry(payload)
      else await updateHomeworkEntry(editor.id, payload)
      setEditor(null)
      await loadBaseData()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteEntry = async (entry) => {
    if (!confirm(lang === 'ar' ? `حذف "${entry.title}" وكل تسليمات الطلاب؟` : `Delete "${entry.title}" and all student submissions?`)) return
    try {
      await deleteHomeworkEntry(entry.id)
      await loadBaseData()
    } catch (err) {
      alert(err.message)
    }
  }

  const updateQuestion = (idx, patch) =>
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) => (i === idx ? { ...q, ...patch } : q)),
    }))

  const removeQuestion = (idx) =>
    setForm((prev) => ({ ...prev, questions: prev.questions.filter((_, i) => i !== idx) }))

  const addSubpoint = (qIdx) =>
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) =>
        i === qIdx ? { ...q, subpoints: [...(q.subpoints || []), newSubpoint()] } : q
      ),
    }))

  /**
   * Deleting a subpoint is destructive (a student may already have answered
   * it), so it is confirmed. The survivors are re-numbered automatically
   * because the roman label comes from the position, not from stored data.
   */
  const removeSubpoint = (qIdx, spIdx) => {
    const sp = form.questions[qIdx]?.subpoints?.[spIdx]
    const label = romanNumeral(spIdx + 1)
    const question = lang === 'ar'
      ? `حذف النقطة الفرعية (${label})؟ سيتم إعادة ترقيم الباقي تلقائياً.`
      : `Delete subpoint ${label}? The remaining subpoints are re-numbered automatically.`
    if (!confirm(question)) return
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) =>
        i === qIdx ? { ...q, subpoints: q.subpoints.filter((_, si) => si !== spIdx) } : q
      ),
    }))
    if (sp) setFormError('')
  }

  /** Move a subpoint up/down; ids travel with it so answers stay mapped. */
  const moveSubpoint = (qIdx, spIdx, dir) =>
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) => {
        if (i !== qIdx) return q
        const list = [...(q.subpoints || [])]
        const target = spIdx + dir
        if (target < 0 || target >= list.length) return q
        ;[list[spIdx], list[target]] = [list[target], list[spIdx]]
        return { ...q, subpoints: list }
      }),
    }))

  const updateSubpoint = (qIdx, spIdx, patch) =>
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) =>
        i === qIdx
          ? { ...q, subpoints: q.subpoints.map((sp, si) => (si === spIdx ? { ...sp, ...patch } : sp)) }
          : q
      ),
    }))

  const toggleGroupId = (gid) =>
    setForm((prev) => ({
      ...prev,
      groupIds: prev.groupIds.includes(gid)
        ? prev.groupIds.filter((id) => id !== gid)
        : [...prev.groupIds, gid],
    }))

  /* ---------- Submissions & answer-key marking ---------- */
  const openSubmissions = async (entry) => {
    setViewingEntry(entry)
    setGradeMsg('')
    setLoadingSubs(true)
    try {
      // Passing the entry lets the API layer mark every stored answer sheet
      // against the answer key (correct / incorrect / percentage).
      const rows = await fetchSubmissionsForAssignment(entry.id, entry)
      setSubs(rows)
      const d = {}
      rows.forEach((r) => {
        d[r.student_id] = { score: r.score ?? '', feedback: r.feedback ?? '' }
      })
      setDrafts(d)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingSubs(false)
    }
  }

  const handleSaveGrade = async (student) => {
    if (!viewingEntry) return
    setSavingId(student.id)
    try {
      const sub = subs.find((s) => s.student_id === student.id)
      await upsertHomeworkSubmissionGrade({
        assignmentId: viewingEntry.id,
        studentId: student.id,
        score: drafts[student.id]?.score ?? '',
        feedback: drafts[student.id]?.feedback ?? '',
        answers: sub?.answers && Object.keys(sub.answers).length ? sub.answers : null,
        questions: viewingEntry.questions || [],
      })
      setGradeMsg(t('gradeSavedMsg'))
      setTimeout(() => setGradeMsg(''), 3500)
      await openSubmissions(viewingEntry)
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingId(null)
    }
  }

  /**
   * Mark EVERY submitted answer sheet against the answer key at once and
   * persist the resulting score / correct / incorrect / percentage.
   */
  const handleAutoGradeAll = async () => {
    if (!viewingEntry) return
    if (!(viewingEntry.questions || []).length) {
      alert(lang === 'ar' ? 'أضف أسئلة ونموذج إجابة أولاً.' : 'Add questions with an answer key first.')
      return
    }
    setAutoGrading(true)
    try {
      const res = await autoGradeAssignmentSubmissions(viewingEntry)
      setGradeMsg(
        lang === 'ar'
          ? `تم تصحيح ${res.graded} ورقة آلياً — متوسط النتيجة ${res.stats.averagePercent}% (صحيح: ${res.stats.totalCorrect} / خطأ: ${res.stats.totalIncorrect})`
          : `Auto-marked ${res.graded} paper(s) — average ${res.stats.averagePercent}% (correct: ${res.stats.totalCorrect} / incorrect: ${res.stats.totalIncorrect})`
      )
      setTimeout(() => setGradeMsg(''), 6000)
      await openSubmissions(viewingEntry)
    } catch (err) {
      alert(err.message)
    } finally {
      setAutoGrading(false)
    }
  }

  /**
   * Open one student's paper. The breakdown is re-derived from the answer
   * key here (admins hold the key) so a paper stored before nested
   * subpoints existed still shows per-subpoint detail, and so every row
   * carries the OPTIONS + key that the answer editor needs — the stored
   * `submissions.breakdown` only holds the marks.
   */
  const openReview = async (student, sub) => {
    const questions = viewingEntry?.questions || []
    const derived = gradeSubmissionAgainstKey({
      questions,
      answers: sub.answers || {},
    })
    const stored = Array.isArray(sub.breakdown) && sub.breakdown.length ? sub.breakdown : null
    setReviewSub({
      student,
      sub,
      breakdown: buildReviewBreakdown({ stored, derived: derived.breakdown, questions }),
    })
    setAuditRows([])
    setShowAudit(false)
    setEditError('')
    try {
      setAuditRows(await fetchSubmissionAnswerEdits(sub.id))
    } catch (err) {
      console.warn('Could not load the answer audit trail:', err)
    }
  }

  /** Ask to change ONE answer — a whole question or a single subpoint. */
  const openEditAnswer = (row) => {
    setEditAnswer(row)
    setEditChoice(row.currentAnswer || '')
    setConfirmEdit(false)
    setEditError('')
  }

  const closeEditAnswer = () => {
    setEditAnswer(null)
    setEditChoice('')
    setConfirmEdit(false)
    setEditError('')
  }

  /**
   * Persist the change. The database verifies the admin, rewrites only this
   * one answer, re-marks the paper and records the audit row — the UI is
   * refreshed from the server's response, never updated optimistically.
   */
  const handleConfirmEditAnswer = async () => {
    const next = String(editChoice ?? '').trim()
    if (!editAnswer || !next) return
    if (next === String(editAnswer.currentAnswer ?? '').trim()) {
      setEditError(lang === 'ar' ? 'الإجابة الجديدة مطابقة للحالية.' : 'The new answer is the same as the current one.')
      return
    }

    setEditBusy(true)
    setEditError('')
    try {
      await adminUpdateSubmissionAnswer({
        submissionId: editAnswer.sub.id,
        questionId: editAnswer.questionId,
        subpointId: editAnswer.subpointId || null,
        answer: next,
      })
      setGradeMsg(lang === 'ar' ? 'تم تغيير الإجابة وإعادة التصحيح.' : 'Answer changed and the paper was re-graded.')
      setTimeout(() => setGradeMsg(''), 4000)

      // Re-read the submission list, then re-open the same paper so the
      // admin sees the recalculated score immediately.
      const rows = await fetchSubmissionsForAssignment(viewingEntry.id, viewingEntry)
      setSubs(rows)
      const fresh = rows.find((r) => r.id === editAnswer.sub.id)
      if (fresh) {
        await openReview(editAnswer.student, fresh)
      } else {
        setReviewSub(null)
      }
      closeEditAnswer()
    } catch (err) {
      // Nothing was changed optimistically, so the UI is still truthful.
      setEditError(err.message || (lang === 'ar' ? 'تعذر تغيير الإجابة.' : 'The answer could not be changed.'))
    } finally {
      setEditBusy(false)
    }
  }

  // Entries list respects the universal group filter: when a group is
  // selected, show homework assigned to that group + general homework.
  const visibleEntries = entries.filter((e) => {
    if (!selectedGroupName) return true
    return !e.groupName || e.groupName === selectedGroupName
  })

  const enrolledStudents = viewingEntry
    ? students.filter((s) => {
        const matchYear = String(s.year_id) === String(viewingEntry.yearId)
        const matchGroup = !selectedGroupName || (s.group_name || '') === selectedGroupName
        return matchYear && matchGroup
      })
    : []

  const submissionMap = {}
  subs.forEach((s) => { submissionMap[s.student_id] = s })

  const gradedRows = enrolledStudents.filter((s) => submissionMap[s.id]?.status === 'graded' && submissionMap[s.id]?.score != null)
  const submittedRows = enrolledStudents.filter((s) => submissionMap[s.id] && submissionMap[s.id]?.status !== 'graded')

  // Class statistics are derived from CORRECTNESS, never from how many
  // students handed something in.
  const classStats = summarizeGrades(
    enrolledStudents
      .map((s) => submissionMap[s.id])
      .filter((sub) => sub && sub.percentage != null)
  )
  const avgPercent = classStats.averagePercent
  const totalCorrect = classStats.totalCorrect
  const totalIncorrect = classStats.totalIncorrect

  const totalPointsOf = (entry) => entry.totalPoints || entry.maxScore || 0

  /* ---------- Lesson gating (legacy) ---------- */
  const loadGatingData = useCallback(async () => {
    try {
      const allLessons = await fetchLessonsFromSupabase()
      setLessons(allLessons)
      if (allLessons.length > 0 && !selectedLessonId) {
        setSelectedLessonId(allLessons[0].id)
      }
    } catch (err) {
      console.error('Failed to load lesson gating data:', err)
    }
  }, [selectedLessonId])

  useEffect(() => { loadGatingData() }, [loadGatingData])

  const selectedLesson = lessons.find((l) => String(l.id) === String(selectedLessonId)) || lessons[0]

  useEffect(() => {
    if (selectedLesson) {
      const model = selectedLesson.modelAnswers || {}
      const questions = selectedLesson.homeworkQuestions || []
      setModelAnswersMap(model)
      setQuestionCount(questions.length > 0 ? questions.length : Object.keys(model).length > 0 ? Object.keys(model).length : 5)
      setHomeworkQuestionsList(questions)
      loadLessonSubmissions(selectedLesson.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLesson?.id])

  const loadLessonSubmissions = async (lessonId) => {
    setLoadingLessonSubs(true)
    try {
      const subsRows = await fetchHomeworkSubmissionsForLesson(lessonId)
      setLessonSubs(subsRows)
    } catch (err) {
      console.warn('Error loading submissions:', err)
    } finally {
      setLoadingLessonSubs(false)
    }
  }

  const handleModelOptionChange = (qKey, optionLetter) => {
    setModelAnswersMap((prev) => ({ ...prev, [String(qKey)]: optionLetter }))
  }

  /** Re-mark every stored paper of the selected lesson against the key. */
  const handleRegradeLesson = async () => {
    if (!selectedLesson) return
    setRegrading(true)
    try {
      const res = await regradeLessonSubmissions({
        lessonId: selectedLesson.id,
        questions: selectedLesson.homeworkQuestions || homeworkQuestionsList,
        modelAnswers: modelAnswersMap,
      })
      setSuccessMsg(
        lang === 'ar'
          ? `تمت إعادة تصحيح ${res.updated} ورقة — المتوسط ${res.stats.averagePercent}% (صحيح: ${res.stats.totalCorrect} / خطأ: ${res.stats.totalIncorrect})`
          : `Re-marked ${res.updated} paper(s) — average ${res.stats.averagePercent}% (correct: ${res.stats.totalCorrect} / incorrect: ${res.stats.totalIncorrect})`
      )
      setTimeout(() => setSuccessMsg(''), 6000)
      await loadLessonSubmissions(selectedLesson.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setRegrading(false)
    }
  }

  const handleSaveModelAnswers = async (e) => {
    e.preventDefault()
    if (!selectedLesson) return
    setSavingModel(true)
    try {
      let updatedQuestions = homeworkQuestionsList
      if (!updatedQuestions || updatedQuestions.length === 0) {
        updatedQuestions = Array.from({ length: questionCount }, (_, i) => ({
          id: String(i + 1),
          question: `السؤال ${i + 1}: اختر الإجابة الصحيحة`,
          options: ['A) الخيار أ', 'B) الخيار ب', 'C) الخيار ج', 'D) الخيار د'],
          correctAnswer: modelAnswersMap[String(i + 1)] || 'A',
        }))
      } else {
        updatedQuestions = updatedQuestions.map((q, i) => ({
          ...q,
          correctAnswer: modelAnswersMap[String(q.id || i + 1)] || q.correctAnswer || 'A',
        }))
      }

      await updateLessonInSupabase(selectedLesson.id, {
        ...selectedLesson,
        modelAnswers: modelAnswersMap,
        homeworkQuestions: updatedQuestions,
      })

      setLessons((prev) =>
        prev.map((l) => (l.id === selectedLesson.id ? { ...l, modelAnswers: modelAnswersMap, homeworkQuestions: updatedQuestions } : l))
      )

      setSuccessMsg(lang === 'ar' ? 'تم حفظ نموذج الإجابة بنجاح!' : 'Model answer key saved successfully!')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (err) {
      console.error(err)
      alert(err.message)
    } finally {
      setSavingModel(false)
    }
  }

  const gatingStudents = students.filter((s) => {
    const matchYear = !selectedLesson ? true : String(s.year_id) === String(selectedLesson.yearId)
    const matchGroup = !selectedGroupName || (s.group_name || '') === selectedGroupName
    return matchYear && matchGroup
  })

  const lessonSubmissionMap = {}
  lessonSubs.forEach((sub) => { lessonSubmissionMap[sub.studentId] = sub })

  const submittedCount = gatingStudents.filter((s) => Boolean(lessonSubmissionMap[s.id])).length
  const avgScore = submittedCount > 0
    ? Math.round(gatingStudents.reduce((sum, s) => {
        const sub = lessonSubmissionMap[s.id]
        return sum + (sub ? sub.percentage : 0)
      }, 0) / submittedCount)
    : 0

  const formTotalPoints = computeHomeworkTotalPoints(form.questions)

  /* ================================================================== */
  return (
    <div className="space-y-6 font-ibm">
      {/* ============================ MODULE HEADER ============================ */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-yellow-400/20 text-yellow-500 flex items-center justify-center">
              <ClipboardList className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-xl">{t('homeworkModuleTitle')}</h3>
              <p className="text-xs text-slate-500">{t('homeworkModuleSubtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Universal group filter */}
            <div className="w-64">
              <GroupFilterSelect
                value={groupId}
                onChange={setGroupId}
                groups={groups}
                compact
              />
            </div>
            <button
              onClick={() => { setEditor('create'); setForm(EMPTY_FORM()); setFormError('') }}
              className="px-5 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-yellow-400/20 transition"
            >
              <Plus className="w-4 h-4" />
              <span>{t('newHomework')}</span>
            </button>
          </div>
        </div>

        {/* Internal section switcher */}
        <div className="flex flex-wrap gap-2 border-t border-slate-200 dark:border-zinc-800 pt-4">
          {[
            { id: 'entries', label: t('homeworkEntriesSection'), icon: ListChecks },
            { id: 'gating', label: t('lessonGatingSection'), icon: Key },
          ].map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                  section === s.id
                    ? 'bg-yellow-400 text-black shadow'
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:text-yellow-500'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{s.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 text-sm font-bold text-center flex items-center justify-center gap-2">
          <Check className="w-5 h-5 text-emerald-500" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* ========================================================================
          SECTION 1 : HOMEWORK ENTRIES  (CRUD + submissions & grading)
         ======================================================================== */}
      {section === 'entries' && (
        <div className="space-y-6">
          {/* Entries list */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h4 className="font-bold text-lg flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-yellow-500" />
                <span>{t('homeworkEntriesSection')} ({visibleEntries.length})</span>
              </h4>
              <span className="text-[11px] text-slate-400 font-bold">
                {selectedGroupName ? `${t('filterByGroup')} ${selectedGroupName}` : t('allGroups')}
              </span>
            </div>

            {loadError && (
              <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-bold flex items-start justify-between gap-3">
                <span className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{loadError}</span>
                </span>
                <button onClick={loadBaseData} className="shrink-0 underline underline-offset-2">
                  {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                </button>
              </div>
            )}

            {loading ? (
              <div className="py-14 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-yellow-500" /></div>
            ) : visibleEntries.length === 0 ? (
              <div className="py-14 text-center text-slate-500 space-y-2">
                <ClipboardList className="w-10 h-10 mx-auto text-slate-300 dark:text-zinc-700" />
                <p className="text-sm font-bold">{t('noHomeworkYet')}</p>
                <button
                  onClick={() => { setEditor('create'); setForm(EMPTY_FORM()); setFormError('') }}
                  className="mt-2 px-4 py-2 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> {t('newHomework')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleEntries.map((entry) => {
                  const year = YEARS.find((y) => y.id === entry.yearId)
                  const qCount = entry.questions?.length || 0
                  return (
                    <div
                      key={entry.id}
                      className="p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-yellow-400/40 transition"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => { setEditor(entry); setForm(entryToForm(entry)); setFormError('') }}
                            className="font-bold text-sm hover:text-yellow-500 transition text-start"
                          >
                            {entry.title}
                          </button>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            entry.isPublished
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400'
                          }`}>
                            {entry.isPublished ? t('homeworkPublished') : t('homeworkDraft')}
                          </span>
                          {entry.groupName && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                              {t('entryLinkedGroup')}: {entry.groupName}
                            </span>
                          )}
                          {entry.explanationVideoUrl && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 inline-flex items-center gap-1">
                              <PlayCircle className="w-3 h-3" />
                              {t('explanationVideoTitle')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          {year ? (lang === 'ar' ? year.titleAr : year.title) : entry.yearId}
                          {entry.dueDate && (
                            <>
                              {' · '}{t('dueDate')}:{' '}
                              <span className="font-mono">{new Date(entry.dueDate).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB')}</span>
                            </>
                          )}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap text-[11px] font-bold text-slate-600 dark:text-zinc-300">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700">
                            <FileText className="w-3 h-3 text-yellow-500" />
                            {qCount} {t('homeworkQuestionsCount')}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700">
                            <Award className="w-3 h-3 text-yellow-500" />
                            {t('totalPointsLabel')}: {totalPointsOf(entry)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <button
                          onClick={() => openSubmissions(entry)}
                          className="px-3.5 py-2 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-bold flex items-center gap-1.5 transition"
                        >
                          <Users className="w-4 h-4" />
                          <span>{t('submissionsAndGrading')}</span>
                        </button>
                        <button
                          onClick={() => { setEditor(entry); setForm(entryToForm(entry)); setFormError('') }}
                          className="p-2 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:text-yellow-500 transition"
                          title={t('editHomework')}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteEntry(entry)}
                          className="p-2 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 hover:bg-red-100 transition"
                          title={t('delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ---------------- Create / Edit Homework Modal ---------------- */}
          {editor && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-3xl w-full space-y-5 max-h-[88vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-zinc-800">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    {editor === 'create' ? <Plus className="w-5 h-5 text-yellow-500" /> : <Pencil className="w-5 h-5 text-yellow-500" />}
                    <span>{editor === 'create' ? t('addHomework') : t('editHomework')}</span>
                  </h3>
                  <button onClick={() => setEditor(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
                </div>

                <form onSubmit={handleSaveEntry} className="space-y-5">
                  {/* Basics */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold mb-1.5">{t('title')}</label>
                      <input
                        type="text" required value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold mb-1.5">{t('description')}</label>
                      <textarea
                        rows={2} value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1.5">{t('gradeLabel')}</label>
                      <select
                        value={form.yearId} onChange={(e) => setForm({ ...form, yearId: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                      >
                        {YEARS.map((y) => <option key={y.id} value={y.id}>{lang === 'ar' ? y.titleAr : y.title}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1.5">{t('dueDate')}</label>
                      <input
                        type="datetime-local" value={form.dueDate}
                        onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold mb-1.5">{lang === 'ar' ? 'المجموعات المستهدفة' : 'Target Groups'} ({t('optional')})</label>
                      <div className="rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black p-3 space-y-2">
                        <p className="text-[11px] text-slate-400 font-bold">
                          {lang === 'ar' ? 'إذا لم تختر أي مجموعة، سيكون الواجب متاحاً لكل طلاب الصف.' : 'If no groups are selected, homework is available to all students in the grade.'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {groups
                            .filter((g) => !g.year_id || String(g.year_id) === String(form.yearId))
                            .map((g) => (
                              <label key={g.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-xs font-bold transition ${
                                form.groupIds.includes(g.id)
                                  ? 'bg-yellow-400/15 border-yellow-400/50 text-yellow-700 dark:text-yellow-300'
                                  : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400'
                              }`}>
                                <input
                                  type="checkbox"
                                  checked={form.groupIds.includes(g.id)}
                                  onChange={() => toggleGroupId(g.id)}
                                  className="w-3.5 h-3.5 accent-yellow-400"
                                />
                                <span>{g.name}</span>
                              </label>
                            ))}
                          {groups.filter((g) => !g.year_id || String(g.year_id) === String(form.yearId)).length === 0 && (
                            <span className="text-xs text-slate-400">{lang === 'ar' ? 'لا توجد مجموعات لهذا الصف' : 'No groups for this grade'}</span>
                          )}
                        </div>
                        {/* Keep legacy group_name for backward compat */}
                        <input type="hidden" value={form.groupName} onChange={() => {}} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1.5">{t('attachmentUrl')}</label>
                      <input
                        type="url" value={form.attachmentUrl}
                        onChange={(e) => setForm({ ...form, attachmentUrl: e.target.value })}
                        placeholder="https://..."
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                      />
                    </div>
                    <label className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-bold cursor-pointer">
                      <input
                        type="checkbox" checked={form.isPublished}
                        onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
                        className="w-4 h-4 accent-yellow-400"
                      />
                      <span>{t('homeworkPublished')}</span>
                    </label>
                  </div>

                  {/* -------- Homework explanation video (gated for students) -------- */}
                  <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <PlayCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <h5 className="text-sm font-extrabold">{t('explanationVideoTitle')}</h5>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold mb-1.5">{t('explanationVideoUrlLabel')}</label>
                        <input
                          type="url" value={form.explanationVideoUrl}
                          onChange={(e) => setForm({ ...form, explanationVideoUrl: e.target.value })}
                          placeholder="https://youtu.be/… | https://drive.google.com/file/d/…"
                          dir="ltr"
                          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-black text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1.5">
                          {t('explanationVideoTitleLabel')} ({t('optional')})
                        </label>
                        <input
                          type="text" value={form.explanationVideoTitle}
                          onChange={(e) => setForm({ ...form, explanationVideoTitle: e.target.value })}
                          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-black text-sm"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-start gap-1.5">
                      <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{t('explanationVideoAdminHint')}</span>
                    </p>
                  </div>

                  {/* Questions editor */}
                  <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-black/40 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <ListChecks className="w-4 h-4 text-yellow-500" />
                        <span>{t('homeworkQuestionsCount')} ({form.questions.length})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1.5 rounded-xl bg-yellow-400/15 text-yellow-700 dark:text-yellow-300 border border-yellow-400/30 text-xs font-extrabold">
                          {t('totalPointsLabel')}: {formTotalPoints}
                        </span>
                        <button
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, questions: [...prev.questions, newQuestion()] }))}
                          className="px-3.5 py-1.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-bold flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" /> {t('addQuestion')}
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 font-bold">{t('totalPointsAuto')}</p>

                    <div className="space-y-4">
                      {form.questions.map((q, idx) => (
                        <div key={q.id} className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 space-y-3">
                          <div className="flex items-start gap-2">
                            <span className="w-7 h-7 rounded-lg bg-yellow-400 text-black flex items-center justify-center text-xs font-bold shrink-0 mt-1">
                              {idx + 1}
                            </span>
                            <div className="flex-1 space-y-1.5">
                              <label className="block text-[11px] font-bold text-slate-500">{t('questionText')}</label>
                              <textarea
                                rows={1} required value={q.question}
                                onChange={(e) => updateQuestion(idx, { question: e.target.value })}
                                placeholder={lang === 'ar' ? 'اكتب نص السؤال...' : 'Type the question text...'}
                                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm resize-y"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeQuestion(idx)}
                              disabled={form.questions.length <= 1}
                              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-30"
                              title={t('delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Parent options — hidden once the question is a
                              container for subpoints, so the two levels can
                              never be confused. */}
                          {!q.subpoints?.length && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 ltr:pl-0 ltr:sm:pl-9 rtl:pr-0 rtl:sm:pr-9">
                              {q.options.map((opt, oi) => {
                                const letter = LETTERS[oi]
                                return (
                                  <div key={oi} className="flex items-center gap-1.5">
                                    <input
                                      type="text" value={opt}
                                      onChange={(e) => {
                                        const opts = [...q.options]
                                        opts[oi] = e.target.value
                                        updateQuestion(idx, { options: opts })
                                      }}
                                      placeholder={`${letter}) ${lang === 'ar' ? 'اختيار' : 'Option'}`}
                                      className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => updateQuestion(idx, { answer: letter })}
                                      className={`min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:px-3 sm:py-2 rounded-lg text-sm font-extrabold transition ${
                                        q.answer === letter
                                          ? 'bg-emerald-500 text-white'
                                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 hover:border-emerald-400'
                                      }`}
                                      title={`${t('correctAnswer')}: ${letter}`}
                                      aria-label={`${t('correctAnswer')}: ${letter}`}
                                    >
                                      ✓
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          <div className="flex items-center gap-3 ltr:pl-0 ltr:sm:pl-9 rtl:pr-0 rtl:sm:pr-9 flex-wrap">
                            {!q.subpoints?.length && (
                              <>
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                                  {t('correctAnswer')}:
                                  <select
                                    value={q.answer}
                                    onChange={(e) => updateQuestion(idx, { answer: e.target.value })}
                                    className="px-3 py-2.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-extrabold focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                  >
                                    {LETTERS.map((l) => <option key={l} value={l}>{l}</option>)}
                                  </select>
                                </label>
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                                  {t('pointsLabel')}:
                                  <input
                                    type="number" min="0.5" step="0.5" value={q.points}
                                    onChange={(e) => updateQuestion(idx, { points: e.target.value })}
                                    className="w-24 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-extrabold text-center focus:outline-none focus:ring-2 focus:ring-yellow-400"
                                  />
                                </label>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => addSubpoint(idx)}
                              className="px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-xs font-bold flex items-center gap-1.5 hover:bg-purple-100 transition"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>{t('addSubpoint')}</span>
                            </button>
                            {q.subpoints?.length > 0 && (
                              <span className="text-[10px] font-bold text-purple-500">
                                {lang === 'ar'
                                  ? `درجة السؤال = مجموع النقاط الفرعية (${computeHomeworkTotalPoints([q])})`
                                  : `Question score = sum of subpoints (${computeHomeworkTotalPoints([q])})`}
                              </span>
                            )}
                          </div>

                          {/* ---------------- SUBPOINTS EDITOR ---------------- */}
                          {q.subpoints?.length > 0 && (
                            <div className="ltr:pl-0 ltr:sm:pl-9 rtl:pr-0 rtl:sm:pr-9 space-y-2.5 border-t-2 border-dashed border-purple-200 dark:border-purple-900 pt-3.5 mt-1">
                              <p className="text-[11px] font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                                <ListChecks className="w-3.5 h-3.5" />
                                <span>{t('subpointsLabel')} ({q.subpoints.length})</span>
                                <span className="text-slate-400 font-normal">
                                  — {lang === 'ar' ? 'الترقيم تلقائي (i, ii, iii)' : 'numbered automatically (i, ii, iii)'}
                                </span>
                              </p>

                              {q.subpoints.map((sp, spIdx) => (
                                <div
                                  key={sp.id}
                                  className="p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/25 border border-purple-200/60 dark:border-purple-800/60 space-y-2.5"
                                >
                                  {/* header: generated label + move + delete */}
                                  <div className="flex items-start gap-2">
                                    <span
                                      className="w-8 h-8 rounded-lg bg-purple-500 text-white flex items-center justify-center text-[11px] font-extrabold shrink-0 font-mono"
                                      dir="ltr"
                                      title={lang === 'ar' ? 'الترقيم تلقائي' : 'Numbering is automatic'}
                                    >
                                      {romanNumeral(spIdx + 1)}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <label className="block text-[10px] font-bold text-purple-600 dark:text-purple-300 mb-1">
                                        {t('subpointText')}
                                      </label>
                                      <textarea
                                        rows={1}
                                        value={sp.question}
                                        onChange={(e) => updateSubpoint(idx, spIdx, { question: e.target.value })}
                                        placeholder={lang === 'ar' ? 'نص النقطة الفرعية...' : 'Subpoint text...'}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm resize-y"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => moveSubpoint(idx, spIdx, -1)}
                                        disabled={spIdx === 0}
                                        className="p-1 rounded-md text-slate-400 hover:text-purple-600 hover:bg-purple-100 dark:hover:bg-purple-950/50 disabled:opacity-25"
                                        title={lang === 'ar' ? 'تحريك لأعلى' : 'Move up'}
                                        aria-label={lang === 'ar' ? 'تحريك لأعلى' : 'Move up'}
                                      >
                                        <ChevronUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => moveSubpoint(idx, spIdx, 1)}
                                        disabled={spIdx === q.subpoints.length - 1}
                                        className="p-1 rounded-md text-slate-400 hover:text-purple-600 hover:bg-purple-100 dark:hover:bg-purple-950/50 disabled:opacity-25"
                                        title={lang === 'ar' ? 'تحريك لأسفل' : 'Move down'}
                                        aria-label={lang === 'ar' ? 'تحريك لأسفل' : 'Move down'}
                                      >
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => removeSubpoint(idx, spIdx)}
                                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0"
                                      title={t('removeSubpoint')}
                                      aria-label={t('removeSubpoint')}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>

                                  {/* the four editable MCQ options */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {sp.options.map((opt, oi) => {
                                      const letter = LETTERS[oi]
                                      return (
                                        <div key={oi} className="flex items-center gap-1.5">
                                          <input
                                            type="text"
                                            value={opt}
                                            onChange={(e) => {
                                              const opts = [...sp.options]
                                              opts[oi] = e.target.value
                                              updateSubpoint(idx, spIdx, { options: opts })
                                            }}
                                            placeholder={`${letter}) ${lang === 'ar' ? 'اختيار' : 'Option'}`}
                                            className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => updateSubpoint(idx, spIdx, { answer: letter })}
                                            className={`min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 sm:px-2.5 sm:py-2 rounded-lg text-xs font-extrabold transition ${
                                              sp.answer === letter
                                                ? 'bg-emerald-500 text-white'
                                                : 'bg-slate-100 dark:bg-zinc-800 text-slate-500 hover:border-emerald-400'
                                            }`}
                                            title={`${t('correctAnswer')}: ${letter}`}
                                            aria-label={`${t('correctAnswer')}: ${letter}`}
                                          >
                                            ✓
                                          </button>
                                        </div>
                                      )
                                    })}
                                  </div>

                                  {/* correct answer + points */}
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                                      {t('correctAnswer')}:
                                      <select
                                        value={sp.answer}
                                        onChange={(e) => updateSubpoint(idx, spIdx, { answer: e.target.value })}
                                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-extrabold focus:outline-none focus:ring-2 focus:ring-purple-400"
                                      >
                                        <option value="">—</option>
                                        {LETTERS.map((l) => <option key={l} value={l}>{l}</option>)}
                                      </select>
                                    </label>
                                    <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                                      {t('pointsLabel')}:
                                      <input
                                        type="number" min="0.5" step="0.5" value={sp.points}
                                        onChange={(e) => updateSubpoint(idx, spIdx, { points: e.target.value })}
                                        className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-extrabold text-center"
                                      />
                                    </label>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {formError && (
                    <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-bold flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{formError}</span>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit" disabled={saving}
                      className="flex-1 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      <span>{saving ? t('loading') : (editor === 'create' ? t('addHomework') : t('save'))}</span>
                    </button>
                    <button
                      type="button" onClick={() => setEditor(null)}
                      className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ---------------- Submissions & Grading Modal ---------------- */}
          {viewingEntry && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-4xl w-full space-y-5 max-h-[88vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-3 flex-wrap border-b border-slate-200 dark:border-zinc-800 pb-3">
                  <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <Users className="w-5 h-5 text-yellow-500" />
                      <span>{viewingEntry.title}</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      {t('totalPointsLabel')}: {totalPointsOf(viewingEntry)} · {t('homeworkQuestionsCount')}: {viewingEntry.questions?.length || 0}
                    </p>
                  </div>
                  <button onClick={() => { setViewingEntry(null); setReviewSub(null) }} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
                </div>

                <p className="text-xs text-slate-500 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-zinc-800 rounded-2xl p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                  <span>{t('answerKeyGradingHint')}</span>
                </p>

                {/* Auto-mark every answer sheet against the answer key */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleAutoGradeAll}
                    disabled={autoGrading || !(viewingEntry.questions || []).length}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold inline-flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition"
                  >
                    {autoGrading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                    <span>{t('autoGradeAllBtn')}</span>
                  </button>
                  <span className="text-[11px] text-slate-400 font-bold">{t('autoGradeAllHint')}</span>
                </div>

                {gradeMsg && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 text-xs font-bold text-center flex items-center justify-center gap-2">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>{gradeMsg}</span>
                  </div>
                )}

                {/* Summary stats — computed from correct vs incorrect answers */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800 text-center">
                    <span className="text-xs text-slate-500 font-bold block">{t('enrolledStudents')}</span>
                    <span className="text-2xl font-extrabold font-outfit">{enrolledStudents.length}</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-sky-50 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-700 text-center">
                    <span className="text-xs text-sky-700 dark:text-sky-300 font-bold block">{t('submittedCountShort')}</span>
                    <span className="text-2xl font-extrabold font-outfit text-sky-600 dark:text-sky-400">{submittedRows.length}</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-center">
                    <span className="text-xs text-emerald-700 dark:text-emerald-300 font-bold block">{t('gradedCountShort')}</span>
                    <span className="text-2xl font-extrabold font-outfit text-emerald-600 dark:text-emerald-400">{gradedRows.length}</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-center">
                    <span className="text-xs text-emerald-700 dark:text-emerald-300 font-bold block">{t('correctAnswersLabel')}</span>
                    <span className="text-2xl font-extrabold font-outfit text-emerald-600 dark:text-emerald-400">{totalCorrect}</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 text-center">
                    <span className="text-xs text-red-700 dark:text-red-300 font-bold block">{t('incorrectAnswersLabel')}</span>
                    <span className="text-2xl font-extrabold font-outfit text-red-600 dark:text-red-400">{totalIncorrect}</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-300 dark:border-purple-700 text-center">
                    <span className="text-xs text-purple-700 dark:text-purple-300 font-bold block">{t('avgGradeShort')}</span>
                    <span className="text-2xl font-extrabold font-outfit text-purple-600 dark:text-purple-400">{avgPercent}%</span>
                  </div>
                </div>

                {loadingSubs ? (
                  <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-yellow-500" /></div>
                ) : enrolledStudents.length === 0 ? (
                  <p className="text-center text-sm text-slate-500 py-10">
                    {selectedGroupName ? `— ${t('noStudentsFound')} (${selectedGroupName}) —` : `— ${t('noStudentsFound')} —`}
                  </p>
                ) : (
                  <div className="overflow-x-auto -mx-2">
                    <table className="w-full text-sm min-w-[760px]">
                      <thead>
                        <tr className="text-xs text-slate-400 border-b border-slate-200 dark:border-zinc-800">
                          <th className="p-3 text-start font-bold">{t('student')}</th>
                          <th className="p-3 text-start font-bold">{t('groupCol')}</th>
                          <th className="p-3 text-start font-bold">{t('submissionStatusCol')}</th>
                          <th className="p-3 text-start font-bold">{t('correctIncorrectCol')}</th>
                          <th className="p-3 text-start font-bold">{t('percentageLabel')}</th>
                          <th className="p-3 text-start font-bold">{t('earnedGradeCol')}</th>
                          <th className="p-3 text-start font-bold">{t('teacherFeedback')}</th>
                          <th className="p-3 text-end font-bold">{t('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {enrolledStudents.map((student) => {
                          const sub = submissionMap[student.id]
                          const status = sub ? (sub.status === 'graded' ? 'graded' : 'submitted') : 'not_submitted'
                          const grade = drafts[student.id]
                          return (
                            <tr key={student.id} className="border-b border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-800/30 transition">
                              <td className="p-3">
                                <span className="font-bold text-sm block">{student.full_name}</span>
                                <span className="text-[11px] text-slate-400 font-mono" dir="ltr">{student.phone}</span>
                              </td>
                              <td className="p-3">
                                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                                  {student.group_name || t('noGroupAssigned')}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${STATUS_PILL[status]}`}>
                                  {status === 'graded' ? t('graded') : status === 'submitted' ? t('submitted') : t('notSubmittedShort')}
                                </span>
                                {sub?.submitted_at && (
                                  <span className="block text-[10px] text-slate-400 font-mono mt-1">
                                    {new Date(sub.submitted_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB')}
                                  </span>
                                )}
                              </td>

                              {/* Correct vs incorrect — straight from the answer key */}
                              <td className="p-3">
                                {sub?.correctCount != null ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                      ✓ {sub.correctCount}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                                      ✕ {sub.incorrectCount ?? 0}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-slate-400">—</span>
                                )}
                              </td>

                              <td className="p-3">
                                {sub?.percentage != null ? (
                                  <span className={`font-extrabold font-mono text-xs ${
                                    sub.percentage >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                                  }`}>
                                    {sub.percentage}%
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400">—</span>
                                )}
                              </td>

                              <td className="p-3">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number" min="0" max={totalPointsOf(viewingEntry)} step="0.5"
                                    value={grade?.score ?? ''}
                                    onChange={(e) => setDrafts({ ...drafts, [student.id]: { ...drafts[student.id], score: e.target.value } })}
                                    className="w-20 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-extrabold text-center font-mono"
                                  />
                                  <span className="text-xs text-slate-400 font-mono">/ {totalPointsOf(viewingEntry)}</span>
                                </div>
                              </td>
                              <td className="p-3">
                                <input
                                  type="text"
                                  value={grade?.feedback ?? ''}
                                  onChange={(e) => setDrafts({ ...drafts, [student.id]: { ...drafts[student.id], feedback: e.target.value } })}
                                  placeholder={t('teacherFeedback')}
                                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs"
                                />
                              </td>
                              <td className="p-3 text-end">
                                <div className="flex items-center justify-end gap-1.5">
                                  {sub?.id && (
                                    <button
                                      onClick={() => openReview(student, sub)}
                                      title={t('answerReviewTitle')}
                                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-xs font-bold inline-flex items-center gap-1.5 hover:text-yellow-500"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleSaveGrade(student)}
                                    disabled={savingId === student.id}
                                    className="px-3.5 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black text-xs font-bold inline-flex items-center gap-1.5"
                                  >
                                    {savingId === student.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                    <span>{t('saveGrade')}</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* -------- Per-student answer review (student answer vs answer key) -------- */}
      {reviewSub && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 sm:p-6 max-w-2xl w-full space-y-4 max-h-[88vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-zinc-800 pb-3">
              <div className="min-w-0">
                <h3 className="font-bold text-base flex items-center gap-2">
                  <ListChecks className="w-5 h-5 text-yellow-500 shrink-0" />
                  <span className="truncate">{t('answerReviewTitle')} — {reviewSub.student.full_name}</span>
                </h3>
                <p className="text-xs text-slate-500">
                  {t('correctAnswersLabel')}: {reviewSub.sub.correctCount ?? 0} ·{' '}
                  {t('incorrectAnswersLabel')}: {reviewSub.sub.incorrectCount ?? 0} ·{' '}
                  {t('percentageLabel')}: {reviewSub.sub.percentage ?? 0}% ·{' '}
                  <span className="font-mono">{reviewSub.sub.score ?? 0} / {reviewSub.sub.totalPoints ?? totalPointsOf(viewingEntry || {})}</span>
                </p>
              </div>
              <button onClick={() => setReviewSub(null)} className="shrink-0 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            {/* Audit trail of previous admin answer changes */}
            {auditRows.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
                <button
                  onClick={() => setShowAudit((v) => !v)}
                  className="w-full px-4 py-2.5 bg-slate-50 dark:bg-black/40 text-xs font-bold flex items-center justify-between gap-2 hover:bg-slate-100 dark:hover:bg-zinc-800/50 transition"
                >
                  <span className="flex items-center gap-1.5">
                    <History className="w-4 h-4 text-purple-500" />
                    {lang === 'ar' ? 'سجل تغيير الإجابات' : 'Answer change history'} ({auditRows.length})
                  </span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showAudit ? 'rotate-180' : ''}`} />
                </button>
                {showAudit && (
                  <ul className="divide-y divide-slate-100 dark:divide-zinc-800 text-[11px]">
                    {auditRows.map((a) => (
                      <li key={a.id} className="px-4 py-2.5 space-y-0.5">
                        <span className="font-bold">
                          {lang === 'ar' ? 'سؤال' : 'Question'} {a.questionId}
                          {a.subpointId ? ` · ${subpointLabelFor(reviewSub.breakdown, a.questionId, a.subpointId)}` : ''}
                        </span>
                        <span className="font-mono text-slate-500" dir="ltr">
                          {' '}{a.previousAnswer || '—'} → {a.newAnswer}
                        </span>
                        <span className="block text-slate-400">
                          {a.editorName ? `${lang === 'ar' ? 'بواسطة' : 'by'} ${a.editorName} · ` : ''}
                          {new Date(a.createdAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}
                          {a.scoreAfter != null && ` · ${a.scoreBefore ?? 0} → ${a.scoreAfter}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="space-y-3">
              {!reviewSub.breakdown.length && (
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {lang === 'ar'
                      ? 'لا توجد أسئلة محفوظة لهذا الواجب، لذلك لا يمكن عرض إجابات الطالب أو تعديلها. أضف الأسئلة ونموذج الإجابة أولاً.'
                      : 'This homework has no stored questions, so the answers cannot be shown or edited. Add the questions and the answer key first.'}
                  </span>
                </div>
              )}
              {reviewSub.breakdown.map((b) => (
                <div
                  key={b.questionId || b.number}
                  className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden"
                >
                  {/* -------- parent question header -------- */}
                  <div className={`px-3 py-2.5 text-xs font-bold flex items-start justify-between gap-3 ${
                    b.isCorrect
                      ? 'bg-emerald-50 dark:bg-emerald-950/40'
                      : 'bg-red-50 dark:bg-red-950/30'
                  }`}>
                    <span className="flex-1">
                      <span className="text-yellow-600 dark:text-yellow-400">{b.number}.</span> {b.question}
                    </span>
                    <span className="font-mono shrink-0 flex items-center gap-1.5">
                      {b.isCorrect
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        : <XCircle className="w-4 h-4 text-red-500" />}
                      {!b.hasSubpoints && <span>{b.studentLetter || b.studentAnswer || '—'}</span>}
                      {!b.hasSubpoints && !b.isCorrect && (
                        <span className="text-emerald-600 dark:text-emerald-400">→ {b.correctAnswer || b.correctLetter || '—'}</span>
                      )}
                      <span className="text-slate-400">({b.earnedPoints}/{b.points})</span>
                    </span>
                  </div>

                  {/* -------- plain question: one editable answer -------- */}
                  {!b.hasSubpoints && (
                    <div className="px-3 py-2.5 flex items-center justify-between gap-3 bg-white dark:bg-zinc-900">
                      <span className="text-[11px] text-slate-500 font-bold">
                        {lang === 'ar' ? 'إجابة الطالب' : 'Student answer'}:{' '}
                        <span className="font-mono text-slate-800 dark:text-zinc-200">{b.studentLetter || b.studentAnswer || '—'}</span>
                        {' · '}
                        {lang === 'ar' ? 'الصحيحة' : 'Correct'}:{' '}
                        <span className="font-mono text-emerald-600 dark:text-emerald-400">{b.correctAnswer || '—'}</span>
                      </span>
                      {/* Editable even without a key: the database refuses
                          to promote an unmarkable paper to `graded`, and the
                          dialog says so. */}
                      <button
                        onClick={() => openEditAnswer({
                          student: reviewSub.student,
                          sub: reviewSub.sub,
                          questionId: String(b.questionId),
                          questionNumber: b.number,
                          subpointId: null,
                          label: '',
                          question: b.question,
                          options: b.options || [],
                          currentAnswer: b.studentLetter || b.studentAnswer || '',
                          correctAnswer: b.correctLetter || b.correctAnswer || '',
                          points: b.points,
                        })}
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-[11px] font-bold inline-flex items-center gap-1.5 hover:bg-purple-100 transition"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>{lang === 'ar' ? 'تعديل الإجابة' : 'Edit Answer'}</span>
                      </button>
                    </div>
                  )}

                  {/* -------- nested subpoints, each editable on its own -------- */}
                  {b.hasSubpoints && (
                    <ul className="divide-y divide-slate-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                      {(b.subpoints || []).map((sp) => (
                        <li key={sp.subpointId} className="px-3 py-2.5 space-y-1.5">
                          <p className="text-[11px] font-bold flex items-start gap-1.5">
                            <span className="text-purple-600 dark:text-purple-300 font-mono shrink-0" dir="ltr">
                              {sp.label || romanNumeral(sp.number)}
                            </span>
                            <span className="flex-1">{sp.question}</span>
                            <span className={`shrink-0 font-mono inline-flex items-center gap-1 ${
                              sp.isCorrect ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
                            }`}>
                              {sp.isCorrect ? '✓' : '✕'}
                              <span>{sp.earnedPoints}/{sp.points}</span>
                            </span>
                          </p>
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <span className="text-[11px] text-slate-500 font-bold">
                              {lang === 'ar' ? 'إجابة الطالب' : 'Student answer'}:{' '}
                              <span className="font-mono text-slate-800 dark:text-zinc-200">{sp.studentLetter || sp.studentAnswer || '—'}</span>
                              {' · '}
                              {lang === 'ar' ? 'الصحيحة' : 'Correct'}:{' '}
                              <span className="font-mono text-emerald-600 dark:text-emerald-400">{sp.correctAnswer || '—'}</span>
                            </span>
                            <button
                              onClick={() => openEditAnswer({
                                student: reviewSub.student,
                                sub: reviewSub.sub,
                                questionId: String(b.questionId),
                                questionNumber: b.number,
                                subpointId: String(sp.subpointId),
                                label: sp.label || romanNumeral(sp.number),
                                question: sp.question,
                                options: sp.options || [],
                                currentAnswer: sp.studentLetter || sp.studentAnswer || '',
                                correctAnswer: sp.correctLetter || sp.correctAnswer || '',
                                points: sp.points,
                              })}
                              className="shrink-0 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-[11px] font-bold inline-flex items-center gap-1.5 hover:bg-purple-100 transition"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>{lang === 'ar' ? 'تعديل الإجابة' : 'Edit Answer'}</span>
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* -------- Edit ONE answer (admin only, re-grades server-side) -------- */}
      {editAnswer && (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 sm:p-6 max-w-md w-full space-y-4 max-h-[88vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-base flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-purple-500 shrink-0" />
                <span>{lang === 'ar' ? 'تعديل إجابة طالب' : "Edit Student's Answer"}</span>
              </h3>
              <button onClick={closeEditAnswer} className="shrink-0 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {lang === 'ar'
                  ? 'سيؤدي هذا إلى تعديل تسليم الطالب وإعادة تصحيح الورقة بالكامل تلقائياً، وتسجيل التغيير في السجل.'
                  : "This changes the student's submitted work. The whole paper is re-graded automatically and the change is recorded in the audit trail."}
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-1.5 text-[11px] font-bold">
              <div className="flex justify-between gap-3 p-2.5 rounded-lg bg-slate-50 dark:bg-black/40">
                <dt className="text-slate-500">{lang === 'ar' ? 'الطالب' : 'Student'}</dt>
                <dd className="truncate">{editAnswer.student.full_name}</dd>
              </div>
              <div className="flex justify-between gap-3 p-2.5 rounded-lg bg-slate-50 dark:bg-black/40">
                <dt className="text-slate-500">{lang === 'ar' ? 'الواجب' : 'Homework'}</dt>
                <dd className="truncate">{viewingEntry?.title}</dd>
              </div>
              <div className="flex justify-between gap-3 p-2.5 rounded-lg bg-slate-50 dark:bg-black/40">
                <dt className="text-slate-500">{lang === 'ar' ? 'السؤال' : 'Question'}</dt>
                <dd className="text-end">
                  {editAnswer.questionNumber}
                  {editAnswer.label ? <span className="font-mono text-purple-600 dark:text-purple-300" dir="ltr"> ({editAnswer.label})</span> : null}
                </dd>
              </div>
              <div className="flex justify-between gap-3 p-2.5 rounded-lg bg-slate-50 dark:bg-black/40">
                <dt className="text-slate-500">{lang === 'ar' ? 'الإجابة الحالية' : 'Current answer'}</dt>
                <dd className="font-mono">{editAnswer.currentAnswer || '—'}</dd>
              </div>
            </dl>

            <p className="text-[11px] font-bold text-slate-500">{editAnswer.question}</p>

            {!editAnswer.correctAnswer && (
              <p className="p-2.5 rounded-lg bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-zinc-800 text-[11px] font-bold text-slate-600 dark:text-zinc-300 flex items-start gap-2">
                <Key className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                <span>
                  {lang === 'ar'
                    ? 'لا يوجد نموذج إجابة لهذا السؤال، لذا لن تتغير الدرجة بعد التعديل.'
                    : 'This item has no answer key, so the score will not change after the edit.'}
                </span>
              </p>
            )}

            {!confirmEdit ? (
              <>
                {(editAnswer.options || []).length ? (
                  <div className="grid grid-cols-1 gap-1.5">
                    {(editAnswer.options || []).map((opt, oi) => {
                      const letter = OPTION_LETTERS[oi]
                      const selected = editChoice === letter
                      return (
                        <button
                          key={oi}
                          type="button"
                          onClick={() => { setEditChoice(letter); setEditError('') }}
                          className={`px-3 py-2.5 rounded-xl text-xs font-bold border text-start transition ${
                            selected
                              ? 'bg-purple-500 border-purple-600 text-white'
                              : 'bg-slate-50 dark:bg-black/40 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300 hover:border-purple-400/60'
                          }`}
                        >
                          <span className="font-mono" dir="ltr">{letter})</span> {String(opt ?? '').replace(/^[A-F]\s*[).:\-–]\s*/, '')}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  // A question with no options is a free-text item: the
                  // database accepts and normalizes the text itself, so the
                  // admin must not be stranded with an empty choice list.
                  <label className="block space-y-1.5">
                    <span className="block text-[11px] font-bold text-slate-500">
                      {lang === 'ar' ? 'الإجابة الجديدة' : 'New answer'}
                    </span>
                    <input
                      type="text"
                      value={editChoice}
                      onChange={(e) => { setEditChoice(e.target.value); setEditError('') }}
                      placeholder={lang === 'ar' ? 'اكتب إجابة الطالب' : "Type the student's answer"}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-black text-xs font-bold"
                    />
                    <span className="block text-[10px] text-slate-400">
                      {lang === 'ar'
                        ? 'تُقرأ هذه الإجابة كنص وتُقارن بنموذج الإجابة بعد التطبيع.'
                        : 'This answer is stored as text and compared with the key after normalization.'}
                    </span>
                  </label>
                )}

                {editError && (
                  <p className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-[11px] font-bold">
                    {editError}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setConfirmEdit(true)}
                    disabled={!String(editChoice || '').trim() || String(editChoice).trim() === String(editAnswer.currentAnswer || '').trim()}
                    className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-extrabold text-xs"
                  >
                    {lang === 'ar' ? 'متابعة' : 'Continue'}
                  </button>
                  <button onClick={closeEditAnswer} className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-xs">
                    {t('cancel')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs font-bold space-y-1">
                  <p>{lang === 'ar' ? 'هل أنت متأكد من تغيير إجابة هذا الطالب؟' : "Are you sure you want to change this student's answer?"}</p>
                  <p className="font-mono text-[11px] text-slate-600 dark:text-zinc-300" dir="ltr">
                    {editAnswer.currentAnswer || '—'} → {editChoice}
                  </p>
                </div>

                {editError && (
                  <p className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-[11px] font-bold">
                    {editError}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleConfirmEditAnswer}
                    disabled={editBusy}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-extrabold text-xs inline-flex items-center justify-center gap-2"
                  >
                    {editBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    <span>{lang === 'ar' ? 'تأكيد التغيير' : 'Confirm Change'}</span>
                  </button>
                  <button onClick={() => { setConfirmEdit(false); setEditError('') }} disabled={editBusy}
                    className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-xs disabled:opacity-60">
                    {lang === 'ar' ? 'رجوع' : 'Back'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================
          SECTION 2 : LESSON HOMEWORK & VIDEO GATING (legacy model-answer flow)
         ======================================================================== */}
      {section === 'gating' && (
        <div className="space-y-8">
          {/* Lesson selector */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-yellow-500" />
                <h3 className="text-lg font-bold">{t('lessonGatingSection')}</h3>
              </div>
              <p className="text-xs text-slate-500">{t('modelAnswerHint')}</p>
            </div>

            <div className="w-full md:w-96">
              <label className="block text-xs font-bold text-slate-400 mb-1">{lang === 'ar' ? 'اختر الدرس' : 'Select Lesson'}:</label>
              <select
                value={selectedLessonId}
                onChange={(e) => setSelectedLessonId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-bold truncate"
              >
                {lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title} ({lang === 'ar' ? YEARS.find((y) => y.id === l.yearId)?.shortTitleAr : YEARS.find((y) => y.id === l.yearId)?.shortTitle || 'عام'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedLesson && (
            <>
              {/* Model answer key input */}
              <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-zinc-800 pb-4">
                  <div className="flex items-center gap-2">
                    <Key className="w-5 h-5 text-yellow-500" />
                    <div>
                      <h4 className="font-bold text-base">{t('modelAnswersTitle')}</h4>
                      <span className="text-xs text-slate-500">{selectedLesson.title}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-bold text-slate-500">{t('totalQuestions')}:</label>
                    <input
                      type="number" min="1" max="30"
                      value={questionCount}
                      onChange={(e) => setQuestionCount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold text-center"
                    />
                  </div>
                </div>

                <form onSubmit={handleSaveModelAnswers} className="space-y-5">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {Array.from({ length: questionCount }, (_, i) => {
                      const qKey = String(i + 1)
                      const currentChoice = modelAnswersMap[qKey] || 'A'
                      return (
                        <div key={qKey} className="p-3.5 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800 space-y-2 text-center">
                          <span className="text-xs font-bold text-slate-500 block">{t('questionNum')} {qKey}</span>
                          <div className="flex justify-center gap-1.5">
                            {['A', 'B', 'C', 'D'].map((letter) => (
                              <button
                                key={letter}
                                type="button"
                                onClick={() => handleModelOptionChange(qKey, letter)}
                                className={`w-8 h-8 rounded-lg text-xs font-extrabold transition ${
                                  currentChoice === letter
                                    ? 'bg-yellow-400 text-black shadow-md scale-105'
                                    : 'bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:border-yellow-400'
                                }`}
                              >
                                {letter}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit" disabled={savingModel}
                      className="px-6 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-xs flex items-center gap-2 shadow"
                    >
                      {savingModel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      <span>{t('saveModelAnswers')}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Lesson submissions statistical table */}
              <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h4 className="font-bold text-lg">{t('studentSubmissionsTable')}</h4>
                    <p className="text-xs text-slate-500">{selectedLesson.title}</p>
                  </div>
                  <div className="w-64">
                    <GroupFilterSelect value={groupId} onChange={setGroupId} groups={groups} compact />
                  </div>
                </div>

                {/* Re-mark every stored paper against the CURRENT answer key */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleRegradeLesson}
                    disabled={regrading || lessonSubs.length === 0}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold inline-flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition"
                  >
                    {regrading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    <span>{t('regradeLessonBtn')}</span>
                  </button>
                  <span className="text-[11px] text-slate-400 font-bold">{t('regradeLessonHint')}</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800 text-center">
                    <span className="text-xs text-slate-500 font-bold block">{lang === 'ar' ? 'إجمالي الطلاب' : 'Total Students'}</span>
                    <span className="text-2xl font-extrabold font-outfit text-slate-900 dark:text-white">{gatingStudents.length}</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-center">
                    <span className="text-xs text-emerald-700 dark:text-emerald-300 font-bold block">{lang === 'ar' ? 'سلّموا (مفتوح 🔓)' : 'Submitted (Unlocked 🔓)'}</span>
                    <span className="text-2xl font-extrabold font-outfit text-emerald-600 dark:text-emerald-400">{submittedCount}</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-center">
                    <span className="text-xs text-amber-700 dark:text-amber-300 font-bold block">{lang === 'ar' ? 'لم يسلّموا (مغلق 🔒)' : 'Pending (Locked 🔒)'}</span>
                    <span className="text-2xl font-extrabold font-outfit text-amber-600 dark:text-amber-400">{Math.max(0, gatingStudents.length - submittedCount)}</span>
                  </div>
                  <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-300 dark:border-purple-700 text-center">
                    <span className="text-xs text-purple-700 dark:text-purple-300 font-bold block">{lang === 'ar' ? 'متوسط الدرجات' : 'Average Score'}</span>
                    <span className="text-2xl font-extrabold font-outfit text-purple-600 dark:text-purple-400">{avgScore}%</span>
                  </div>
                </div>

                {loadingLessonSubs ? (
                  <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-yellow-500" /></div>
                ) : gatingStudents.length === 0 ? (
                  <p className="text-center text-sm text-slate-500 py-8">— {t('noStudentsFound')} —</p>
                ) : (
                  <div className="overflow-x-auto -mx-2">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead>
                        <tr className="text-xs text-slate-400 text-start border-b border-slate-200 dark:border-zinc-800">
                          <th className="p-3 text-start font-bold">{t('student')}</th>
                          <th className="p-3 text-start font-bold">{t('studentGroup')}</th>
                          <th className="p-3 text-start font-bold">{t('submissionDate')}</th>
                          <th className="p-3 text-start font-bold">{t('homeworkScoreLabel')}</th>
                          <th className="p-3 text-start font-bold">{t('unlockStatusCol')}</th>
                          <th className="p-3 text-end font-bold">{t('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gatingStudents.map((student) => {
                          const sub = lessonSubmissionMap[student.id]
                          const groupName = student.group_name || student.groupName || t('unassignedGroup')
                          return (
                            <tr key={student.id} className="border-b border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-800/30 transition">
                              <td className="p-3 font-bold">
                                <span className="block">{student.full_name}</span>
                                <span className="text-[11px] text-slate-400 font-mono" dir="ltr">{student.phone}</span>
                              </td>
                              <td className="p-3">
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">{groupName}</span>
                              </td>
                              <td className="p-3 text-xs text-slate-500 font-mono">
                                {sub?.submittedAt ? new Date(sub.submittedAt).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'}
                              </td>
                              <td className="p-3 font-mono font-bold">
                                {sub ? (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`px-2.5 py-0.5 rounded-lg text-xs font-extrabold ${
                                      sub.percentage >= 60
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                        : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                                    }`}>
                                      {sub.score} / {sub.totalPoints || sub.totalQuestions} ({sub.percentage}%)
                                    </span>
                                    {sub.correctCount != null && (
                                      <span className="text-[10px] text-slate-500">
                                        ✓{sub.correctCount} ✕{sub.incorrectCount ?? 0}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 text-xs">—</span>
                                )}
                              </td>
                              <td className="p-3">
                                {sub ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                                    <Unlock className="w-3 h-3 text-emerald-500" />
                                    <span>{t('unlockedStatus')}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                                    <Lock className="w-3 h-3 text-amber-500" />
                                    <span>{t('lockedStatus')}</span>
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-end">
                                {sub ? (
                                  <button
                                    onClick={() => setViewingSubmission({ ...sub, studentName: student.full_name })}
                                    className="px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-bold inline-flex items-center gap-1"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>{t('viewStudentAnswers')}</span>
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* View student answers modal */}
          {viewingSubmission && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-xl w-full space-y-5 max-h-[85vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
                  <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <Award className="w-5 h-5 text-yellow-500" />
                      <span>{viewingSubmission.studentName}</span>
                    </h3>
                    <span className="text-xs text-slate-400">{selectedLesson?.title}</span>
                  </div>
                  <button onClick={() => setViewingSubmission(null)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 flex justify-between items-center text-sm font-bold text-emerald-800 dark:text-emerald-300">
                  <span>{t('homeworkScoreLabel')}:</span>
                  <span className="text-base font-extrabold font-mono">
                    {viewingSubmission.score} / {viewingSubmission.totalPoints || viewingSubmission.totalQuestions} ({viewingSubmission.percentage}%)
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                    <span className="block text-[11px] font-bold text-slate-500">{t('correctAnswersLabel')}</span>
                    <span className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{viewingSubmission.correctCount ?? 0}</span>
                  </div>
                  <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                    <span className="block text-[11px] font-bold text-slate-500">{t('incorrectAnswersLabel')}</span>
                    <span className="text-lg font-extrabold text-red-600 dark:text-red-400">{viewingSubmission.incorrectCount ?? 0}</span>
                  </div>
                  <div className="p-3 rounded-2xl bg-yellow-400/10 border border-yellow-400/40">
                    <span className="block text-[11px] font-bold text-slate-500">{t('percentageLabel')}</span>
                    <span className="text-lg font-extrabold text-yellow-600 dark:text-yellow-400">{viewingSubmission.percentage ?? 0}%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-500">
                    {lang === 'ar' ? 'مقارنة إجابات الطالب بنموذج الإجابة' : 'Student Answers vs Model Answer Key'}
                  </label>
                  <div className="space-y-2">
                    {(viewingSubmission.breakdown?.length
                      ? viewingSubmission.breakdown
                      : gradeSubmissionAgainstKey({
                          questions: selectedLesson?.homeworkQuestions || [],
                          modelAnswers: selectedLesson?.modelAnswers || {},
                          answers: viewingSubmission.answers || {},
                        }).breakdown
                    ).map((b) => (
                      <div
                        key={b.questionId || b.number}
                        className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold gap-3 ${
                          b.isCorrect
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                            : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                        }`}
                      >
                        <span className="flex-1 truncate">{t('questionNum')} {b.number}{b.question ? ` — ${b.question}` : ''}</span>
                        <div className="flex items-center gap-3 font-mono shrink-0">
                          <span>{lang === 'ar' ? 'إجابة الطالب' : 'Student'}: <strong>{b.studentLetter || b.studentAnswer || '—'}</strong></span>
                          <span>{lang === 'ar' ? 'النموذجية' : 'Key'}: <strong>{b.correctAnswer || b.correctLetter || '—'}</strong></span>
                          <span>{b.isCorrect ? '✅' : '❌'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer note for the sequential dispatch / sync behaviour */}
      <div className="p-4 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-[11px] text-slate-500 dark:text-zinc-400 font-bold flex items-center gap-2">
        <Send className="w-4 h-4 text-green-500 shrink-0" />
        <span>
          {lang === 'ar'
            ? 'الدرجات المحفوظة في قسم التسليمات والتصحيح تظهر تلقائياً في سجل واجبات الطالب.'
            : 'Grades saved in the Submissions & Grading view appear automatically in each student\'s Homework History.'}
        </span>
      </div>
    </div>
  )
}
