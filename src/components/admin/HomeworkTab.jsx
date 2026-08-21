import { useState, useEffect, useCallback } from 'react'
import {
  ClipboardList, Check, Save, Eye, Loader2, Key, Users, Unlock, Lock,
  Plus, Trash2, Award, ChevronRight, X, Sparkles, Filter, FileText
} from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS } from '../../data/dummyData'
import { fetchLessonsFromSupabase, updateLessonInSupabase } from '../../lib/supabase'
import { fetchStudents, fetchHomeworkSubmissionsForLesson, fetchGroups } from '../../lib/api'

export default function HomeworkTab() {
  const { t, lang } = useLanguage()

  const [lessons, setLessons] = useState([])
  const [students, setStudents] = useState([])
  const [groups, setGroups] = useState([])
  const [selectedLessonId, setSelectedLessonId] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')

  const [loading, setLoading] = useState(true)
  const [savingModel, setSavingModel] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  // Model Answer Editor State
  const [modelAnswersMap, setModelAnswersMap] = useState({})
  const [questionCount, setQuestionCount] = useState(5)
  const [homeworkQuestionsList, setHomeworkQuestionsList] = useState([])

  // Submissions State for the selected lesson
  const [submissions, setSubmissions] = useState([])
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)
  const [viewingSubmission, setViewingSubmission] = useState(null)

  const loadBaseData = useCallback(async () => {
    setLoading(true)
    try {
      const [allLessons, allStudents, allGroups] = await Promise.all([
        fetchLessonsFromSupabase(),
        fetchStudents(),
        fetchGroups(),
      ])
      setLessons(allLessons)
      setStudents(allStudents)
      setGroups(allGroups)

      if (allLessons.length > 0 && !selectedLessonId) {
        setSelectedLessonId(allLessons[0].id)
      }
    } catch (err) {
      console.error('Failed to load homework tab data:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedLessonId])

  useEffect(() => {
    loadBaseData()
  }, [loadBaseData])

  const selectedLesson = lessons.find((l) => String(l.id) === String(selectedLessonId)) || lessons[0]

  // Update Model Answer form when selected lesson changes
  useEffect(() => {
    if (selectedLesson) {
      const model = selectedLesson.modelAnswers || {}
      const questions = selectedLesson.homeworkQuestions || []

      setModelAnswersMap(model)
      const count = questions.length > 0 ? questions.length : Object.keys(model).length > 0 ? Object.keys(model).length : 5
      setQuestionCount(count)
      setHomeworkQuestionsList(questions)

      // Load submissions for this lesson
      loadSubmissions(selectedLesson.id)
    }
  }, [selectedLesson?.id])

  const loadSubmissions = async (lessonId) => {
    setLoadingSubmissions(true)
    try {
      const subs = await fetchHomeworkSubmissionsForLesson(lessonId)
      setSubmissions(subs)
    } catch (err) {
      console.warn('Error loading submissions:', err)
    } finally {
      setLoadingSubmissions(false)
    }
  }

  const handleModelOptionChange = (qKey, optionLetter) => {
    setModelAnswersMap((prev) => ({
      ...prev,
      [String(qKey)]: optionLetter,
    }))
  }

  const handleSaveModelAnswers = async (e) => {
    e.preventDefault()
    if (!selectedLesson) return

    setSavingModel(true)
    try {
      // Build questions list if empty
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

      const updated = await updateLessonInSupabase(selectedLesson.id, {
        ...selectedLesson,
        modelAnswers: modelAnswersMap,
        homeworkQuestions: updatedQuestions,
      })

      // Update local lessons list
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

  // Filter students for the statistical table
  const filteredStudents = students.filter((s) => {
    const matchYear = !selectedLesson ? true : String(s.year_id) === String(selectedLesson.yearId)
    const matchGroup = groupFilter === 'all' ? true : (s.group_name || s.groupName) === groupFilter
    return matchYear && matchGroup
  })

  // Build stats
  const submissionMap = {}
  submissions.forEach((sub) => {
    submissionMap[sub.studentId] = sub
  })

  const submittedCount = filteredStudents.filter((s) => Boolean(submissionMap[s.id])).length
  const lockedCount = filteredStudents.length - submittedCount
  const avgScore =
    submittedCount > 0
      ? Math.round(
          filteredStudents.reduce((sum, s) => {
            const sub = submissionMap[s.id]
            return sum + (sub ? sub.percentage : 0)
          }, 0) / submittedCount
        )
      : 0

  return (
    <div className="space-y-8 font-ibm">
      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 text-sm font-bold text-center flex items-center justify-center gap-2">
          <Check className="w-5 h-5 text-emerald-500" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Lesson Selector Header */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-yellow-500" />
            <h3 className="text-lg font-bold">{t('adminHomeworkTab')}</h3>
          </div>
          <p className="text-xs text-slate-500">{t('modelAnswerHint')}</p>
        </div>

        {/* Lesson dropdown */}
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
          {/* =========================================================================
              SECTION A: MODEL ANSWER KEY INPUT INTERFACE
             ========================================================================= */}
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
                  type="number"
                  min="1"
                  max="30"
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
                    <div
                      key={qKey}
                      className="p-3.5 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800 space-y-2 text-center"
                    >
                      <span className="text-xs font-bold text-slate-500 block">
                        {t('questionNum')} {qKey}
                      </span>

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
                  type="submit"
                  disabled={savingModel}
                  className="px-6 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-xs flex items-center gap-2 shadow"
                >
                  {savingModel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{t('saveModelAnswers')}</span>
                </button>
              </div>
            </form>
          </div>

          {/* =========================================================================
              SECTION B: STATISTICAL TABLE PER LESSON (STUDENT NAME, SCORE, UNLOCK STATUS)
             ========================================================================= */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h4 className="font-bold text-lg">{t('studentSubmissionsTable')}</h4>
                <p className="text-xs text-slate-500">{selectedLesson.title}</p>
              </div>

              {/* Group filter for statistical table */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-500 shrink-0">{t('filterByGroup')}</label>
                <select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold"
                >
                  <option value="all">{t('allGroups')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.name}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Overview Summary Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800 text-center">
                <span className="text-xs text-slate-500 font-bold block">{lang === 'ar' ? 'إجمالي الطلاب' : 'Total Students'}</span>
                <span className="text-2xl font-extrabold font-outfit text-slate-900 dark:text-white">
                  {filteredStudents.length}
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-center">
                <span className="text-xs text-emerald-700 dark:text-emerald-300 font-bold block">
                  {lang === 'ar' ? 'سلّموا الواجب (الفيديو مفتوح 🔓)' : 'Submitted (Unlocked 🔓)'}
                </span>
                <span className="text-2xl font-extrabold font-outfit text-emerald-600 dark:text-emerald-400">
                  {submittedCount}
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-center">
                <span className="text-xs text-amber-700 dark:text-amber-300 font-bold block">
                  {lang === 'ar' ? 'لم يسلّموا (الفيديو مغلق 🔒)' : 'Pending (Locked 🔒)'}
                </span>
                <span className="text-2xl font-extrabold font-outfit text-amber-600 dark:text-amber-400">
                  {lockedCount}
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-300 dark:border-purple-700 text-center">
                <span className="text-xs text-purple-700 dark:text-purple-300 font-bold block">
                  {lang === 'ar' ? 'متوسط الدرجات' : 'Average Score'}
                </span>
                <span className="text-2xl font-extrabold font-outfit text-purple-600 dark:text-purple-400">
                  {avgScore}%
                </span>
              </div>
            </div>

            {/* Statistical Table */}
            {loadingSubmissions ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
              </div>
            ) : filteredStudents.length === 0 ? (
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
                    {filteredStudents.map((student) => {
                      const sub = submissionMap[student.id]
                      const isUnlocked = Boolean(sub)
                      const groupName = student.group_name || student.groupName || t('unassignedGroup')

                      return (
                        <tr
                          key={student.id}
                          className="border-b border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-800/30 transition"
                        >
                          <td className="p-3 font-bold">
                            <span className="block">{student.full_name}</span>
                            <span className="text-[11px] text-slate-400 font-mono" dir="ltr">{student.phone}</span>
                          </td>
                          <td className="p-3">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                              {groupName}
                            </span>
                          </td>
                          <td className="p-3 text-xs text-slate-500 font-mono">
                            {sub?.submittedAt ? new Date(sub.submittedAt).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : '—'}
                          </td>
                          <td className="p-3 font-mono font-bold">
                            {sub ? (
                              <span className={`px-2.5 py-0.5 rounded-lg text-xs font-extrabold ${
                                sub.percentage >= 60
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                              }`}>
                                {sub.score} / {sub.totalQuestions} ({sub.percentage}%)
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                          <td className="p-3">
                            {isUnlocked ? (
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

      {/* View Student Answers Modal */}
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
              <button
                onClick={() => setViewingSubmission(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 flex justify-between items-center text-sm font-bold text-emerald-800 dark:text-emerald-300">
              <span>{t('homeworkScoreLabel')}:</span>
              <span className="text-base font-extrabold font-mono">
                {viewingSubmission.score} / {viewingSubmission.totalQuestions} ({viewingSubmission.percentage}%)
              </span>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-500">
                {lang === 'ar' ? 'مقارنة إجابات الطالب بنموذج الإجابة' : 'Student Answers vs Model Answer Key'}
              </label>

              <div className="space-y-2">
                {Array.from({ length: viewingSubmission.totalQuestions || 5 }, (_, i) => {
                  const qKey = String(i + 1)
                  const studentAns = viewingSubmission.answers?.[qKey] || '—'
                  const modelAns = selectedLesson?.modelAnswers?.[qKey] || 'A'
                  const isMatch = studentAns === modelAns || studentAns.startsWith(modelAns)

                  return (
                    <div
                      key={qKey}
                      className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold ${
                        isMatch
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                          : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                      }`}
                    >
                      <span>{t('questionNum')} {qKey}</span>
                      <div className="flex items-center gap-3 font-mono">
                        <span>إجابة الطالب: <strong>{studentAns}</strong></span>
                        <span>النموذجية: <strong>{modelAns}</strong></span>
                        <span>{isMatch ? '✅' : '❌'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
