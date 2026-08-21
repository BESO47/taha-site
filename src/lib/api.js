import { supabase, isSupabaseConfigured } from './supabase'
import { DEFAULT_GROUPS, SAMPLE_STUDENTS, LESSONS } from '../data/dummyData'
import { gradeSubmissionAgainstKey, summarizeGrades } from './grading'

/**
 * Data access layer for Physics Hub platform.
 * Supports Supabase database operations with robust local caching fallbacks.
 */

// =====================================================================
// GROUPS API
// =====================================================================
export async function fetchGroups() {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('name', { ascending: true })

      if (!error && data && data.length > 0) {
        return data
      }
    } catch (err) {
      console.warn('Failed to fetch groups from Supabase, using default:', err)
    }
  }

  // Fallback to local storage or defaults
  try {
    const raw = localStorage.getItem('physics_hub_groups')
    if (raw) return JSON.parse(raw)
  } catch (_) {}

  return DEFAULT_GROUPS
}

export async function createGroup({ name, yearId = '5', description = '' }) {
  const cleanName = String(name || '').trim()
  if (!cleanName) throw new Error('Group name cannot be empty')

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('groups')
        .insert([{ name: cleanName, year_id: String(yearId), description: description || null }])
        .select()
      if (error) throw error
      return data?.[0]
    } catch (err) {
      console.warn('Supabase group insert error:', err)
    }
  }

  // Local storage fallback
  const current = await fetchGroups()
  const newGroup = {
    id: `group_${Date.now()}`,
    name: cleanName,
    year_id: String(yearId),
    description,
    created_at: new Date().toISOString(),
  }
  const updated = [...current, newGroup]
  try {
    localStorage.setItem('physics_hub_groups', JSON.stringify(updated))
  } catch (_) {}
  return newGroup
}

export async function deleteGroup(id) {
  if (isSupabaseConfigured()) {
    try {
      const { error } = await supabase.from('groups').delete().eq('id', id)
      if (error) throw error
    } catch (err) {
      console.warn('Supabase group delete error:', err)
    }
  }

  const current = await fetchGroups()
  const filtered = current.filter((g) => g.id !== id)
  try {
    localStorage.setItem('physics_hub_groups', JSON.stringify(filtered))
  } catch (_) {}
}

export async function updateStudentGroup(studentId, groupName) {
  const cleanGroup = String(groupName || '').trim()

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ group_name: cleanGroup || null })
        .eq('id', studentId)
        .select()
      if (error) throw error
      return data?.[0]
    } catch (err) {
      console.warn('Supabase updateStudentGroup error:', err)
    }
  }

  // Local storage update for fallback
  try {
    const key = `student_group_${studentId}`
    localStorage.setItem(key, cleanGroup)
  } catch (_) {}

  return { id: studentId, group_name: cleanGroup }
}

// =====================================================================
// HOMEWORK SUBMISSIONS & ANSWER-KEY GRADING SYSTEM
// =====================================================================
// Every homework mark on the platform is produced by COMPARING THE
// STUDENT'S ANSWERS WITH THE TEACHER'S ANSWER KEY (see lib/grading.js).
// Handing work in is never a grade by itself: an empty or fully wrong
// paper scores 0%, and the score is weighted by each question's points.

/**
 * Extra analytics columns created by `homework-grading.sql`.
 * Older databases may not have them yet, so every write degrades
 * gracefully to the base columns instead of throwing.
 */
const HOMEWORK_GRADE_COLUMNS = [
  'correct_count', 'incorrect_count', 'unanswered_count',
  'percentage', 'total_points', 'breakdown', 'auto_graded',
]

/** True when PostgREST/Postgres rejected the write because a column is missing. */
function isMissingColumnError(error) {
  if (!error) return false
  const code = String(error.code || '')
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return (
    code === 'PGRST204' || code === '42703' ||
    msg.includes('could not find') && msg.includes('column') ||
    msg.includes('does not exist') && msg.includes('column')
  )
}

/** Remove the optional analytics columns from a payload. */
function stripGradeColumns(payload) {
  const clone = { ...payload }
  HOMEWORK_GRADE_COLUMNS.forEach((c) => delete clone[c])
  return clone
}

/**
 * Re-shape a `homework_submissions` row (or a localStorage record) into the
 * grading result the UI renders: score, correct / incorrect counts and the
 * overall percentage — all derived from the answer key.
 */
export function normalizeHomeworkSubmissionRow(row = {}, extra = {}) {
  const score = Number(row.score ?? row.earnedPoints ?? 0) || 0
  const totalPoints = Number(row.total_points ?? row.totalPoints ?? 0) || 0
  const totalQuestions = Number(row.total_questions ?? row.totalQuestions ?? 0) || 0
  const denominator = totalPoints > 0 ? totalPoints : totalQuestions
  const correctCount = row.correct_count ?? row.correctCount
  const incorrectCount = row.incorrect_count ?? row.incorrectCount
  const percentage = row.percentage != null
    ? Math.round(Number(row.percentage))
    : denominator > 0 ? Math.round((score / denominator) * 100) : 0

  return {
    id: row.id,
    studentId: row.student_id ?? row.studentId,
    lessonId: row.lesson_id ?? row.lessonId,
    answers: row.answers || {},
    score,
    earnedPoints: score,
    totalPoints: denominator,
    totalQuestions: totalQuestions || denominator,
    correctCount: correctCount != null ? Number(correctCount) : null,
    incorrectCount: incorrectCount != null ? Number(incorrectCount) : null,
    unansweredCount: row.unanswered_count ?? row.unansweredCount ?? null,
    percentage,
    breakdown: row.breakdown || row.breakdownItems || [],
    autoGraded: row.auto_graded ?? row.autoGraded ?? true,
    submittedAt: row.submitted_at ?? row.submittedAt ?? null,
    isUnlocked: true,
    ...extra,
  }
}

/**
 * Fetch a student's homework submission for a specific lesson.
 */
export async function fetchHomeworkSubmission({ lessonId, studentId }) {
  if (!lessonId || !studentId) return null

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('homework_submissions')
        .select('*')
        .eq('lesson_id', lessonId)
        .eq('student_id', studentId)
        .maybeSingle()

      if (!error && data) return normalizeHomeworkSubmissionRow(data)
    } catch (err) {
      console.warn('Failed to fetch homework submission from Supabase:', err)
    }
  }

  // Fallback to local storage
  try {
    const key = `hw_sub_${lessonId}_${studentId}`
    const raw = localStorage.getItem(key)
    if (raw) return normalizeHomeworkSubmissionRow(JSON.parse(raw))
  } catch (_) {}

  return null
}

/**
 * Mark a set of answers against the answer key WITHOUT persisting anything.
 * Exposed so the UI (and the admin re-grade tool) can preview a result.
 */
export function gradeHomeworkAnswers({ questions = [], modelAnswers = null, answers = {} } = {}) {
  return gradeSubmissionAgainstKey({ questions, modelAnswers, answers })
}

/**
 * Submit a student's lesson homework.
 *
 * The submission is marked question-by-question against the answer key
 * (`lesson.homeworkQuestions[].answer` and/or `lesson.modelAnswers`) and the
 * resulting score, correct / incorrect counts and percentage are persisted.
 *
 * @returns the stored submission + the full per-question breakdown.
 */
export async function submitHomeworkSubmission({
  lessonId,
  studentId,
  answers = {},
  modelAnswers = {},
  questions = [],
  totalQuestions = 0,
}) {
  if (!lessonId || !studentId) {
    throw new Error('Lesson ID and Student ID are required')
  }

  // ---- 1. MARK THE PAPER AGAINST THE ANSWER KEY -----------------------
  const result = gradeSubmissionAgainstKey({ questions, modelAnswers, answers })

  // Keep a sane denominator when the lesson has no key configured yet:
  // in that case nothing can be marked, so the score stays 0 and the
  // teacher is expected to publish the key (never a "free" full mark).
  const questionCount = result.totalQuestions || Number(totalQuestions) || 0

  const payload = {
    lesson_id: lessonId,
    student_id: studentId,
    answers,
    score: result.earnedPoints,
    total_questions: questionCount,
    total_points: result.totalPoints,
    correct_count: result.correctCount,
    incorrect_count: result.incorrectCount,
    unanswered_count: result.unansweredCount,
    percentage: result.percentage,
    breakdown: result.breakdown,
    auto_graded: result.hasAnswerKey,
    submitted_at: new Date().toISOString(),
  }

  let savedSubmission = null
  let serverResult = null

  // ---- 2. PERSIST (with graceful degradation for older schemas) -------
  if (isSupabaseConfigured()) {
    // 2a. Preferred path: mark on the server so the answer key stays
    //     server-side and a student can never post their own score.
    try {
      const { data, error } = await supabase.rpc('grade_lesson_homework', {
        p_lesson_id: lessonId,
        p_answers: answers,
      })
      if (!error && data) {
        const r = Array.isArray(data) ? data[0] : data
        serverResult = {
          earnedPoints: Number(r.score) || 0,
          totalPoints: Number(r.total_points) || 0,
          totalQuestions: Number(r.total_questions) || questionCount,
          correctCount: Number(r.correct_count) || 0,
          incorrectCount: Number(r.incorrect_count) || 0,
          unansweredCount: Number(r.unanswered_count) || 0,
          percentage: Math.round(Number(r.percentage)) || 0,
          breakdown: r.breakdown || result.breakdown,
          hasAnswerKey: Number(r.total_points) > 0,
        }
      } else if (error) {
        throw error
      }
    } catch (err) {
      console.warn(
        'grade_lesson_homework RPC unavailable (run homework-grading.sql) — ' +
        'marking on the client instead:', err.message || err
      )
    }
  }

  if (isSupabaseConfigured() && !serverResult) {
    try {
      let { data, error } = await supabase
        .from('homework_submissions')
        .upsert(payload, { onConflict: 'lesson_id,student_id' })
        .select()

      if (error && isMissingColumnError(error)) {
        console.warn(
          'homework_submissions is missing the grading columns — run homework-grading.sql. ' +
          'Falling back to the base columns.'
        )
        const legacy = await supabase
          .from('homework_submissions')
          .upsert(stripGradeColumns(payload), { onConflict: 'lesson_id,student_id' })
          .select()
        data = legacy.data
        error = legacy.error
      }

      if (!error && data?.[0]) savedSubmission = data[0]
      else if (error) console.warn('Supabase homework submission upsert error:', error)
    } catch (err) {
      console.warn('Supabase homework submission exception:', err)
    }
  }

  // ---- 3. Mirror locally for instant UI + offline resilience ----------
  const final = serverResult || result
  const localResult = {
    id: savedSubmission?.id || `sub_${Date.now()}`,
    studentId,
    lessonId,
    answers,
    score: final.earnedPoints,
    earnedPoints: final.earnedPoints,
    totalPoints: final.totalPoints,
    totalQuestions: final.totalQuestions || questionCount,
    correctCount: final.correctCount,
    incorrectCount: final.incorrectCount,
    unansweredCount: final.unansweredCount,
    percentage: final.percentage,
    breakdown: final.breakdown,
    autoGraded: final.hasAnswerKey,
    hasAnswerKey: final.hasAnswerKey,
    gradedOnServer: Boolean(serverResult),
    submittedAt: payload.submitted_at,
    isUnlocked: true,
  }

  try {
    const key = `hw_sub_${lessonId}_${studentId}`
    localStorage.setItem(key, JSON.stringify(localResult))

    // Also update global list of submissions
    const allKey = 'physics_hub_all_hw_submissions'
    const allRaw = JSON.parse(localStorage.getItem(allKey) || '[]')
    const filtered = allRaw.filter((s) => !(s.lessonId === lessonId && s.studentId === studentId))
    localStorage.setItem(allKey, JSON.stringify([localResult, ...filtered]))
  } catch (_) {}

  return localResult
}

/**
 * Re-mark every stored submission of a lesson against the CURRENT answer
 * key. Used by the teacher after fixing / publishing the model answers.
 *
 * @returns {{ updated:number, failed:number, results:Array, stats:object }}
 */
export async function regradeLessonSubmissions({ lessonId, questions = [], modelAnswers = {} }) {
  const rows = await fetchHomeworkSubmissionsForLesson(lessonId)
  const results = []
  let updated = 0
  let failed = 0

  for (const row of rows) {
    try {
      const graded = await submitHomeworkSubmission({
        lessonId,
        studentId: row.studentId,
        answers: row.answers || {},
        modelAnswers,
        questions,
      })
      results.push({ ...graded, studentName: row.studentName })
      updated++
    } catch (err) {
      console.warn('Re-grade failed for student', row.studentId, err)
      failed++
    }
  }

  return { updated, failed, results, stats: summarizeGrades(results) }
}

/**
 * Fetch all submissions for a specific lesson (Admin statistical table).
 */
export async function fetchHomeworkSubmissionsForLesson(lessonId) {
  if (!lessonId) return []

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('homework_submissions')
        .select('*, profiles:student_id (id, full_name, phone, parent_phone, year_id, group_name)')
        .eq('lesson_id', lessonId)
        .order('submitted_at', { ascending: false })

      if (!error && Array.isArray(data)) {
        return data.map((d) => normalizeHomeworkSubmissionRow(d, {
          studentName: d.profiles?.full_name || 'طالب',
          phone: d.profiles?.phone || '',
          parentPhone: d.profiles?.parent_phone || '',
          groupName: d.profiles?.group_name || 'عام',
          yearId: d.profiles?.year_id || '5',
        }))
      }
    } catch (err) {
      console.warn('Supabase fetchHomeworkSubmissionsForLesson error:', err)
    }
  }

  // Fallback to local storage
  try {
    const allRaw = JSON.parse(localStorage.getItem('physics_hub_all_hw_submissions') || '[]')
    const matching = allRaw.filter((s) => s.lessonId === lessonId)
    const students = await fetchStudents()

    return matching.map((s) => {
      const st = students.find((x) => x.id === s.studentId)
      return normalizeHomeworkSubmissionRow(s, {
        studentName: st?.full_name || 'طالب',
        phone: st?.phone || '',
        parentPhone: st?.parent_phone || '',
        groupName: st?.group_name || 'عام',
      })
    })
  } catch (_) {}

  return []
}

/**
 * Fetch all homework submissions across all lessons.
 */
export async function fetchAllHomeworkSubmissions() {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('homework_submissions')
        .select('*, profiles:student_id (id, full_name, phone, parent_phone, year_id, group_name), lessons:lesson_id (id, title, year_id)')
        .order('submitted_at', { ascending: false })

      if (!error && Array.isArray(data)) {
        return data.map((d) => normalizeHomeworkSubmissionRow(d, {
          studentName: d.profiles?.full_name || 'طالب',
          phone: d.profiles?.phone || '',
          groupName: d.profiles?.group_name || '',
          yearId: d.profiles?.year_id || '5',
          lessonTitle: d.lessons?.title || 'درس',
        }))
      }
    } catch (err) {
      console.warn('fetchAllHomeworkSubmissions error:', err)
    }
  }

  try {
    const raw = localStorage.getItem('physics_hub_all_hw_submissions')
    if (raw) return JSON.parse(raw)
  } catch (_) {}

  return []
}

/**
 * Fetch all homework submissions for one student.
 */
export async function fetchSubmissionsForStudentLessons(studentId) {
  if (!studentId) return []

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('homework_submissions')
        .select('*, lessons:lesson_id (id, title, year_id, branch, unit)')
        .eq('student_id', studentId)
        .order('submitted_at', { ascending: false })

      if (!error && Array.isArray(data)) {
        return data.map((d) => normalizeHomeworkSubmissionRow(d, {
          lessonTitle: d.lessons?.title || 'درس',
          branch: d.lessons?.branch || '',
          unit: d.lessons?.unit || '',
        }))
      }
    } catch (err) {
      console.warn('fetchSubmissionsForStudentLessons error:', err)
    }
  }

  try {
    const allRaw = JSON.parse(localStorage.getItem('physics_hub_all_hw_submissions') || '[]')
    return allRaw.filter((s) => s.studentId === studentId)
  } catch (_) {}

  return []
}

// =====================================================================
// VIDEOS API
// =====================================================================
export async function fetchVideos({ yearId = null, publishedOnly = true } = {}) {
  if (isSupabaseConfigured()) {
    try {
      let query = supabase.from('videos').select('*').order('sort_order', { ascending: true })
      if (publishedOnly) query = query.eq('is_published', true)
      if (yearId && yearId !== 'all') query = query.eq('year_id', String(yearId))

      const { data, error } = await query
      if (!error && data) return data
    } catch (err) {
      console.warn('fetchVideos Supabase error:', err)
    }
  }
  return []
}

export async function createVideo(payload) {
  const { data, error } = await supabase
    .from('videos')
    .insert([
      {
        title: payload.title,
        description: payload.description || null,
        youtube_url: payload.youtubeUrl,
        year_id: String(payload.yearId || '5'),
        unit: payload.unit || null,
        is_published: payload.isPublished !== false,
        sort_order: Number(payload.sortOrder) || 0,
      },
    ])
    .select()
  if (error) throw error
  return data?.[0]
}

export async function updateVideo(id, payload) {
  const { data, error } = await supabase
    .from('videos')
    .update({
      title: payload.title,
      description: payload.description || null,
      youtube_url: payload.youtubeUrl,
      year_id: String(payload.yearId || '5'),
      unit: payload.unit || null,
      is_published: payload.isPublished !== false,
      sort_order: Number(payload.sortOrder) || 0,
    })
    .eq('id', id)
    .select()
  if (error) throw error
  return data?.[0]
}

export async function deleteVideo(id) {
  const { error } = await supabase.from('videos').delete().eq('id', id)
  if (error) throw error
}

// =====================================================================
// QUIZZES + GRADES
// =====================================================================
export async function fetchQuizzes({ yearId = null } = {}) {
  if (isSupabaseConfigured()) {
    try {
      let query = supabase.from('quizzes').select('*').order('quiz_date', { ascending: false })
      if (yearId && yearId !== 'all') query = query.eq('year_id', String(yearId))
      const { data, error } = await query
      if (!error && data) return data
    } catch (err) {
      console.warn('fetchQuizzes error:', err)
    }
  }
  return []
}

export async function createQuiz(payload) {
  const { data, error } = await supabase
    .from('quizzes')
    .insert([
      {
        title: payload.title,
        description: payload.description || null,
        year_id: String(payload.yearId || '5'),
        branch: payload.branch || null,
        semester: Number(payload.semester) || 1,
        quiz_date: payload.quizDate || new Date().toISOString().slice(0, 10),
        max_score: Number(payload.maxScore) || 100,
      },
    ])
    .select()
  if (error) throw error
  return data?.[0]
}

export async function deleteQuiz(id) {
  const { error } = await supabase.from('quizzes').delete().eq('id', id)
  if (error) throw error
}

export async function fetchGradesForQuiz(quizId) {
  if (!isSupabaseConfigured()) return []
  const { data, error } = await supabase
    .from('grades')
    .select('*, profiles:student_id (full_name, phone, parent_phone, group_name)')
    .eq('quiz_id', quizId)
  if (error) throw error
  return data || []
}

export async function fetchGradesForStudent(studentId) {
  if (!isSupabaseConfigured()) return []
  const { data, error } = await supabase
    .from('grades')
    .select('*, quizzes:quiz_id (title, max_score, quiz_date, branch)')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function upsertGrade({ quizId, studentId, score, notes }) {
  const { data, error } = await supabase
    .from('grades')
    .upsert(
      {
        quiz_id: quizId,
        student_id: studentId,
        score: Number(score),
        notes: notes || null,
      },
      { onConflict: 'quiz_id,student_id' }
    )
    .select()
  if (error) throw error
  return data?.[0]
}

export async function deleteGrade(id) {
  const { error } = await supabase.from('grades').delete().eq('id', id)
  if (error) throw error
}

// =====================================================================
// HOMEWORK ENTRIES  (Unified "Homework" module — formerly "Assignments")
// =====================================================================
// A homework entry lives in the `assignments` table (extended with a
// `questions` JSONB column + computed `total_points`) so the existing
// `submissions` table, RLS policies and grading guard triggers keep
// working unchanged. Each question = { id, question, options[4], answer,
// points }. Total points = sum of question points (fallback: max_score).

export function computeHomeworkTotalPoints(questions = []) {
  const arr = Array.isArray(questions) ? questions : []
  if (arr.length === 0) return 0
  const sum = arr.reduce((acc, q) => acc + (Number(q.points) || 0), 0)
  return Math.round(sum * 100) / 100
}

export function normalizeHomeworkEntry(row = {}) {
  const questions = Array.isArray(row.questions) ? row.questions : []
  const totalPoints = Number(row.total_points) > 0
    ? Number(row.total_points)
    : computeHomeworkTotalPoints(questions) || Number(row.max_score) || 0
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    yearId: row.year_id || '5',
    branch: row.branch || '',
    dueDate: row.due_date || null,
    maxScore: Number(row.max_score) || totalPoints || 0,
    totalPoints,
    questions,
    attachmentUrl: row.attachment_url || '',
    isPublished: row.is_published !== false,
    groupName: row.group_name || '',
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

const HOMEWORK_ENTRY_COLUMNS =
  'id, title, description, year_id, branch, due_date, max_score, total_points, questions, attachment_url, is_published, group_name, created_by, created_at, updated_at'

/** Seed a couple of demo entries for the localStorage (no-Supabase) mode. */
function seedHomeworkEntriesLocal() {
  const seed = [
    {
      id: 'hw-1',
      title: 'واجب التيار الكهربي وقانون أوم',
      description: 'حل أسئلة الدرس الأول: شدة التيار وفرق الجهد والمقاومة الكهربية.',
      year_id: '5',
      branch: 'الكهربية والمغناطيسية',
      due_date: null,
      max_score: 10,
      total_points: 10,
      questions: [
        { id: 'q1', question: 'وحدة قياس شدة التيار الكهربي في النظام الدولي هي:', options: ['A) الأمبير', 'B) الفولت', 'C) الأوم', 'D) الجول'], answer: 'A', points: 5 },
        { id: 'q2', question: 'إذا زادت مساحة مقطع موصل للضعف مع ثبات طوله، فإن مقاومته:', options: ['A) تزداد للضعف', 'B) تقل إلى النصف', 'C) تظل ثابتة', 'D) تزداد 4 أمثال'], answer: 'B', points: 5 },
      ],
      attachment_url: '',
      is_published: true,
      group_name: '',
      created_at: new Date().toISOString(),
    },
    {
      id: 'hw-2',
      title: 'Homework: Ohm\'s Law & Resistance',
      description: 'Solve the Ohm\'s law problems and submit your answers.',
      year_id: '6',
      branch: 'Electromagnetism',
      due_date: new Date(Date.now() + 7 * 864e5).toISOString(),
      max_score: 15,
      total_points: 15,
      questions: [
        { id: 'q1', question: 'Ohm\'s law states that current is directly proportional to:', options: ['A) Resistance', 'B) Voltage', 'C) Power', 'D) Charge'], answer: 'B', points: 5 },
        { id: 'q2', question: 'SI unit of resistance is:', options: ['A) Ampere', 'B) Volt', 'C) Ohm', 'D) Joule'], answer: 'C', points: 5 },
        { id: 'q3', question: 'A resistor dissipates power P. If current doubles, power becomes:', options: ['A) P', 'B) 2P', 'C) 4P', 'D) 8P'], answer: 'C', points: 5 },
      ],
      attachment_url: '',
      is_published: true,
      group_name: '',
      created_at: new Date().toISOString(),
    },
  ]
  try {
    localStorage.setItem('physics_hub_homework_entries', JSON.stringify(seed))
  } catch (_) {}
  return seed
}

/**
 * Fetch all homework entries (unified assignments+homework).
 * @param {{ yearId?: string|null, groupName?: string|null, publishedOnly?: boolean }} opts
 */
export async function fetchHomeworkEntries({ yearId = null, groupName = null, publishedOnly = false } = {}) {
  if (isSupabaseConfigured()) {
    try {
      // select('*') keeps existing installs working even before the
      // questions / total_points / group_name columns are added.
      let query = supabase
        .from('assignments')
        .select('*')
        .order('created_at', { ascending: false })
      if (yearId && yearId !== 'all') query = query.eq('year_id', String(yearId))
      if (groupName && groupName !== 'all') query = query.eq('group_name', groupName)
      if (publishedOnly) query = query.eq('is_published', true)

      const { data, error } = await query
      if (!error && Array.isArray(data)) return data.map(normalizeHomeworkEntry)
    } catch (err) {
      console.warn('fetchHomeworkEntries error:', err)
    }
  }

  // LocalStorage fallback (demo / offline mode)
  try {
    const raw = localStorage.getItem('physics_hub_homework_entries')
    let rows = raw ? JSON.parse(raw) : seedHomeworkEntriesLocal()
    if (yearId && yearId !== 'all') rows = rows.filter((r) => r.year_id === String(yearId))
    if (groupName && groupName !== 'all') rows = rows.filter((r) => (r.group_name || '') === groupName)
    if (publishedOnly) rows = rows.filter((r) => r.is_published !== false)
    return rows.map(normalizeHomeworkEntry)
  } catch (_) {}

  return []
}

/** Alias kept for legacy callers (student profile, WhatsApp reports). */
export async function fetchAssignments({ yearId = null } = {}) {
  return fetchHomeworkEntries({ yearId })
}

export async function createHomeworkEntry(payload) {
  const questions = Array.isArray(payload.questions) ? payload.questions : []
  const totalPoints = computeHomeworkTotalPoints(questions) || Number(payload.maxScore) || 0
  const row = {
    title: payload.title,
    description: payload.description || null,
    year_id: String(payload.yearId || '5'),
    branch: payload.branch || null,
    due_date: payload.dueDate || null,
    max_score: totalPoints || Number(payload.maxScore) || 100,
    total_points: totalPoints || null,
    questions,
    attachment_url: payload.attachmentUrl || null,
    is_published: payload.isPublished !== false,
    group_name: payload.groupName || null,
  }

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.from('assignments').insert([row]).select(HOMEWORK_ENTRY_COLUMNS)
    if (error) throw error
    return normalizeHomeworkEntry(data?.[0])
  }

  // LocalStorage fallback
  const current = await fetchHomeworkEntries()
  const newEntry = { id: `hw_${Date.now()}`, ...row, created_at: new Date().toISOString() }
  const updated = [newEntry, ...current.map((e) => ({
    id: e.id, title: e.title, description: e.description, year_id: e.yearId,
    branch: e.branch, due_date: e.dueDate, max_score: e.maxScore, total_points: e.totalPoints,
    questions: e.questions, attachment_url: e.attachmentUrl, is_published: e.isPublished,
    group_name: e.groupName, created_at: e.createdAt,
  }))]
  try {
    localStorage.setItem('physics_hub_homework_entries', JSON.stringify(updated))
  } catch (_) {}
  return normalizeHomeworkEntry(newEntry)
}

export async function updateHomeworkEntry(id, payload) {
  const questions = Array.isArray(payload.questions) ? payload.questions : []
  const totalPoints = computeHomeworkTotalPoints(questions) || Number(payload.maxScore) || 0
  const row = {
    title: payload.title,
    description: payload.description || null,
    year_id: String(payload.yearId || '5'),
    branch: payload.branch || null,
    due_date: payload.dueDate || null,
    max_score: totalPoints || Number(payload.maxScore) || 100,
    total_points: totalPoints || null,
    questions,
    attachment_url: payload.attachmentUrl || null,
    is_published: payload.isPublished !== false,
    group_name: payload.groupName || null,
  }

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('assignments')
      .update(row)
      .eq('id', id)
      .select(HOMEWORK_ENTRY_COLUMNS)
    if (error) throw error
    return normalizeHomeworkEntry(data?.[0])
  }

  const current = await fetchHomeworkEntries()
  const updated = current.map((e) => (e.id === id
    ? { id: e.id, ...row, created_at: e.createdAt }
    : { id: e.id, title: e.title, description: e.description, year_id: e.yearId, branch: e.branch, due_date: e.dueDate, max_score: e.maxScore, total_points: e.totalPoints, questions: e.questions, attachment_url: e.attachmentUrl, is_published: e.isPublished, group_name: e.groupName, created_at: e.createdAt }))
  try {
    localStorage.setItem('physics_hub_homework_entries', JSON.stringify(updated))
  } catch (_) {}
  return normalizeHomeworkEntry({ id, ...row })
}

export async function deleteHomeworkEntry(id) {
  if (isSupabaseConfigured()) {
    const { error } = await supabase.from('assignments').delete().eq('id', id)
    if (error) throw error
    return
  }
  const current = await fetchHomeworkEntries()
  const filtered = current.filter((e) => e.id !== id)
  try {
    localStorage.setItem('physics_hub_homework_entries', JSON.stringify(filtered.map((e) => ({
      id: e.id, title: e.title, description: e.description, year_id: e.yearId, branch: e.branch,
      due_date: e.dueDate, max_score: e.maxScore, total_points: e.totalPoints, questions: e.questions,
      attachment_url: e.attachmentUrl, is_published: e.isPublished, group_name: e.groupName, created_at: e.createdAt,
    }))))
  } catch (_) {}
}

/**
 * Extra grading columns on `submissions` (added by homework-grading.sql).
 */
const SUBMISSION_GRADE_COLUMNS = [
  'answers', 'correct_count', 'incorrect_count', 'unanswered_count',
  'percentage', 'total_points', 'breakdown', 'auto_graded',
]

function stripSubmissionGradeColumns(payload) {
  const clone = { ...payload }
  SUBMISSION_GRADE_COLUMNS.forEach((c) => delete clone[c])
  return clone
}

/**
 * Normalize a `submissions` row: keeps the raw snake_case fields (the admin
 * table still reads them) and adds the answer-key marking breakdown.
 */
export function normalizeAssignmentSubmission(row = {}, entry = null) {
  const questions = entry?.questions || []
  const answers = row.answers || {}
  const storedPercentage = row.percentage
  const hasStoredBreakdown = row.correct_count != null || row.percentage != null

  // Re-derive the breakdown on the fly when the DB has not stored it yet
  // (older rows / installs that have not run homework-grading.sql).
  let derived = null
  if (!hasStoredBreakdown && questions.length && Object.keys(answers).length) {
    derived = gradeSubmissionAgainstKey({ questions, answers })
  }

  const totalPoints =
    Number(row.total_points) ||
    derived?.totalPoints ||
    Number(entry?.totalPoints) ||
    Number(entry?.maxScore) ||
    0

  const score = row.score == null ? (derived ? derived.earnedPoints : null) : Number(row.score)
  const percentage = storedPercentage != null
    ? Math.round(Number(storedPercentage))
    : derived
      ? derived.percentage
      : score != null && totalPoints > 0
        ? Math.round((score / totalPoints) * 100)
        : null

  return {
    ...row,
    score,
    answers,
    correctCount: row.correct_count != null ? Number(row.correct_count) : derived?.correctCount ?? null,
    incorrectCount: row.incorrect_count != null ? Number(row.incorrect_count) : derived?.incorrectCount ?? null,
    unansweredCount: row.unanswered_count != null ? Number(row.unanswered_count) : derived?.unansweredCount ?? null,
    totalPoints,
    percentage,
    breakdown: row.breakdown || derived?.breakdown || [],
    autoGraded: row.auto_graded ?? Boolean(derived),
    hasAnswers: Object.keys(answers).length > 0,
  }
}

/**
 * Fetch all submissions for a homework entry (assignment), each one marked
 * against the answer key (correct / incorrect / percentage).
 *
 * @param {string} assignmentId
 * @param {object} [entry] the homework entry — enables on-the-fly marking
 */
export async function fetchSubmissionsForAssignment(assignmentId, entry = null) {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('submissions')
        .select('*, profiles:student_id (id, full_name, phone, parent_phone, group_name, year_id)')
        .eq('assignment_id', assignmentId)
        .order('submitted_at', { ascending: false })
      if (!error && Array.isArray(data)) return data.map((r) => normalizeAssignmentSubmission(r, entry))
      if (error) throw error
    } catch (err) {
      console.warn('fetchSubmissionsForAssignment error:', err)
    }
  }

  // LocalStorage fallback for demo grading
  try {
    const raw = JSON.parse(localStorage.getItem('physics_hub_hw_grades') || '{}')
    return (raw[String(assignmentId)] || []).map((s) =>
      normalizeAssignmentSubmission(
        {
          ...s,
          status: s.status || 'graded',
          graded_at: s.graded_at || s.submitted_at || new Date().toISOString(),
        },
        entry
      )
    )
  } catch (_) {}

  return []
}

/** Persist a submission row locally (demo / offline mode). */
function saveLocalAssignmentSubmission(assignmentId, payload) {
  try {
    const key = String(assignmentId)
    const raw = JSON.parse(localStorage.getItem('physics_hub_hw_grades') || '{}')
    const list = (raw[key] || []).filter((s) => s.student_id !== payload.student_id)
    const row = { id: `hwg_${Date.now()}`, ...payload }
    list.unshift(row)
    raw[key] = list
    localStorage.setItem('physics_hub_hw_grades', JSON.stringify(raw))
    return row
  } catch (_) {
    return { id: `hwg_${Date.now()}`, ...payload }
  }
}

/**
 * Upsert a submission row, transparently retrying without the optional
 * grading columns when the database has not been migrated yet.
 */
async function upsertSubmissionRow(payload) {
  let { data, error } = await supabase
    .from('submissions')
    .upsert(payload, { onConflict: 'assignment_id,student_id' })
    .select()

  if (error && isMissingColumnError(error)) {
    console.warn(
      'submissions is missing the grading columns — run homework-grading.sql to enable ' +
      'answer-key marking analytics. Falling back to the base columns.'
    )
    const legacy = await supabase
      .from('submissions')
      .upsert(stripSubmissionGradeColumns(payload), { onConflict: 'assignment_id,student_id' })
      .select()
    data = legacy.data
    error = legacy.error
  }

  if (error) throw error
  return data?.[0]
}

/**
 * ==================== STUDENT: submit MCQ answers ====================
 * Marks the paper against the answer key and stores the result.
 *
 * When Supabase is configured the authoritative marking happens inside the
 * `grade_assignment_submission` SQL function (SECURITY DEFINER) so a student
 * can never post their own score — the key never leaves the server. The
 * identical JS engine is used for the preview / offline fallback.
 *
 * @returns {{ correctCount, incorrectCount, totalQuestions, earnedPoints,
 *             totalPoints, percentage, breakdown, submission }}
 */
export async function submitAssignmentAnswers({
  assignmentId,
  studentId,
  answers = {},
  questions = [],
  content = null,
  fileUrl = null,
}) {
  if (!assignmentId || !studentId) throw new Error('Assignment ID and Student ID are required')

  // Local preview of the mark (also the offline result)
  const local = gradeSubmissionAgainstKey({ questions, answers })

  if (isSupabaseConfigured()) {
    // 1) Server-side authoritative marking
    try {
      const { data, error } = await supabase.rpc('grade_assignment_submission', {
        p_assignment_id: assignmentId,
        p_answers: answers,
        p_content: content,
        p_file_url: fileUrl,
      })
      if (!error && data) {
        const r = Array.isArray(data) ? data[0] : data
        return {
          totalQuestions: Number(r.total_questions ?? local.totalQuestions) || 0,
          correctCount: Number(r.correct_count ?? local.correctCount) || 0,
          incorrectCount: Number(r.incorrect_count ?? local.incorrectCount) || 0,
          unansweredCount: Number(r.unanswered_count ?? local.unansweredCount) || 0,
          earnedPoints: Number(r.score ?? local.earnedPoints) || 0,
          totalPoints: Number(r.total_points ?? local.totalPoints) || 0,
          percentage: Math.round(Number(r.percentage ?? local.percentage)) || 0,
          breakdown: r.breakdown || local.breakdown,
          gradedOnServer: true,
        }
      }
      if (error) throw error
    } catch (err) {
      console.warn(
        'grade_assignment_submission RPC unavailable (run homework-grading.sql) — ' +
        'falling back to client-side marking:', err.message || err
      )
    }

    // 2) Fallback: store the answers; score is written when the RLS/trigger
    //    guard allows it (admin) and re-derived from the key otherwise.
    try {
      const row = await upsertSubmissionRow({
        assignment_id: assignmentId,
        student_id: studentId,
        content,
        file_url: fileUrl,
        answers,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      return { ...local, submission: row, gradedOnServer: false }
    } catch (err) {
      console.warn('submitAssignmentAnswers upsert error:', err)
      throw err
    }
  }

  // Offline / demo mode
  const row = saveLocalAssignmentSubmission(assignmentId, {
    assignment_id: assignmentId,
    student_id: studentId,
    content,
    file_url: fileUrl,
    answers,
    status: local.hasAnswerKey ? 'graded' : 'submitted',
    score: local.hasAnswerKey ? local.earnedPoints : null,
    total_points: local.totalPoints,
    correct_count: local.correctCount,
    incorrect_count: local.incorrectCount,
    unanswered_count: local.unansweredCount,
    percentage: local.percentage,
    breakdown: local.breakdown,
    auto_graded: local.hasAnswerKey,
    submitted_at: new Date().toISOString(),
    graded_at: local.hasAnswerKey ? new Date().toISOString() : null,
  })
  return { ...local, submission: row, gradedOnServer: false }
}

/**
 * Grade a homework entry submission for a student. Upserts so the teacher
 * can also award a grade to students who have not submitted yet.
 *
 * `score` is optional: when the submission already holds MCQ answers the
 * mark is recomputed from the answer key instead of being typed by hand.
 */
export async function upsertHomeworkSubmissionGrade({
  assignmentId,
  studentId,
  score,
  feedback,
  answers = null,
  questions = null,
  grading = null,
}) {
  // Derive the mark from the answer key whenever we have answers.
  const derived = grading || (answers && questions
    ? gradeSubmissionAgainstKey({ questions, answers })
    : null)

  const finalScore = score === '' || score === null || score === undefined
    ? derived ? derived.earnedPoints : null
    : Number(score)

  const payload = {
    assignment_id: assignmentId,
    student_id: studentId,
    status: 'graded',
    score: finalScore,
    feedback: feedback || null,
    graded_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
  }

  if (answers) payload.answers = answers
  if (derived) {
    payload.correct_count = derived.correctCount
    payload.incorrect_count = derived.incorrectCount
    payload.unanswered_count = derived.unansweredCount
    payload.total_points = derived.totalPoints
    payload.percentage = derived.percentage
    payload.breakdown = derived.breakdown
    payload.auto_graded = true
  } else if (finalScore != null && questions) {
    const totalPoints = computeHomeworkTotalPoints(questions)
    payload.total_points = totalPoints || null
    payload.percentage = totalPoints > 0 ? Math.round((finalScore / totalPoints) * 100) : null
    payload.auto_graded = false
  }

  if (isSupabaseConfigured()) {
    return upsertSubmissionRow(payload)
  }

  return saveLocalAssignmentSubmission(assignmentId, payload)
}

/**
 * ============ TEACHER: auto-mark a whole homework entry ==============
 * Re-marks every stored submission of an assignment against the current
 * answer key and writes back score / correct / incorrect / percentage.
 *
 * @returns {{ graded:number, skipped:number, failed:number, stats:object, rows:Array }}
 */
export async function autoGradeAssignmentSubmissions(entry) {
  if (!entry?.id) throw new Error('A homework entry is required')
  const questions = entry.questions || []
  if (!questions.length) throw new Error('This homework entry has no questions / answer key')

  const rows = await fetchSubmissionsForAssignment(entry.id, entry)
  const results = []
  let graded = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const answers = row.answers || {}
    if (!Object.keys(answers).length) { skipped++; continue }

    const result = gradeSubmissionAgainstKey({ questions, answers })
    try {
      await upsertHomeworkSubmissionGrade({
        assignmentId: entry.id,
        studentId: row.student_id,
        feedback: row.feedback || null,
        answers,
        questions,
        grading: result,
      })
      results.push({ ...result, studentId: row.student_id, studentName: row.profiles?.full_name })
      graded++
    } catch (err) {
      console.warn('Auto-grade failed for student', row.student_id, err)
      failed++
    }
  }

  return { graded, skipped, failed, rows: results, stats: summarizeGrades(results) }
}

// =====================================================================
// SUBMISSIONS (unified homework submissions — uses the submissions table)
// =====================================================================

export async function fetchSubmissionsForStudent(studentId) {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('submissions')
        .select('*, assignments:assignment_id (title, max_score, total_points, questions, due_date)')
        .eq('student_id', studentId)
        .order('submitted_at', { ascending: false })
      if (!error && data) {
        return data.map((r) =>
          normalizeAssignmentSubmission(r, {
            questions: r.assignments?.questions || [],
            totalPoints: r.assignments?.total_points,
            maxScore: r.assignments?.max_score,
          })
        )
      }
      if (error) throw error
    } catch (err) {
      console.warn('fetchSubmissionsForStudent error:', err)
    }
  }

  // LocalStorage fallback: demo grades saved from the Homework module
  try {
    const raw = JSON.parse(localStorage.getItem('physics_hub_hw_grades') || '{}')
    const rows = []
    Object.entries(raw).forEach(([assignmentId, list]) => {
      list.forEach((s) => {
        if (s.student_id === studentId) {
          rows.push(normalizeAssignmentSubmission({ ...s, assignment_id: assignmentId, status: s.status || 'graded' }))
        }
      })
    })
    return rows
  } catch (_) {}

  return []
}

/**
 * Submit a homework entry.
 *  - MCQ homework  -> `answers` are marked against the answer key.
 *  - Essay / file  -> stored as `submitted` for manual marking.
 */
export async function submitAssignment({
  assignmentId,
  studentId,
  content,
  fileUrl,
  answers = null,
  questions = [],
}) {
  if (answers && Object.keys(answers).length) {
    return submitAssignmentAnswers({
      assignmentId,
      studentId,
      answers,
      questions,
      content: content || null,
      fileUrl: fileUrl || null,
    })
  }

  if (!isSupabaseConfigured()) {
    return saveLocalAssignmentSubmission(assignmentId, {
      assignment_id: assignmentId,
      student_id: studentId,
      content: content || null,
      file_url: fileUrl || null,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
  }

  return upsertSubmissionRow({
    assignment_id: assignmentId,
    student_id: studentId,
    content: content || null,
    file_url: fileUrl || null,
    status: 'submitted',
  })
}

export async function gradeSubmission(id, { score, feedback }) {
  const { data, error } = await supabase
    .from('submissions')
    .update({
      score: score === '' || score === null ? null : Number(score),
      feedback: feedback || null,
      status: 'graded',
      graded_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
  if (error) throw error
  return data?.[0]
}

export async function uploadSubmissionFile(studentId, file) {
  const safeName = file.name.replace(/[^\w.\-]/g, '_')
  const path = `${studentId}/${Date.now()}-${safeName}`

  const { error } = await supabase.storage.from('submissions').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw error

  const { data } = supabase.storage.from('submissions').getPublicUrl(path)
  return data.publicUrl
}

// =====================================================================
// ATTENDANCE API
// =====================================================================
export async function fetchAttendanceForStudent(studentId) {
  if (!isSupabaseConfigured()) return []
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('student_id', studentId)
    .order('session_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAttendanceByDate(sessionDate) {
  if (!isSupabaseConfigured()) return []
  const { data, error } = await supabase
    .from('attendance')
    .select('*, profiles:student_id (full_name, phone, parent_phone, year_id, group_name)')
    .eq('session_date', sessionDate)
  if (error) throw error
  return data || []
}

export async function upsertAttendance({ studentId, sessionDate, status, yearId, notes }) {
  const { data, error } = await supabase
    .from('attendance')
    .upsert(
      {
        student_id: studentId,
        session_date: sessionDate,
        status,
        year_id: yearId ? String(yearId) : null,
        notes: notes || null,
      },
      { onConflict: 'student_id,session_date' }
    )
    .select()
  if (error) throw error
  return data?.[0]
}

export async function bulkUpsertAttendance(rows) {
  if (!rows.length) return []
  const { data, error } = await supabase
    .from('attendance')
    .upsert(
      rows.map((r) => ({
        student_id: r.studentId,
        session_date: r.sessionDate,
        status: r.status,
        year_id: r.yearId ? String(r.yearId) : null,
        notes: r.notes || null,
      })),
      { onConflict: 'student_id,session_date' }
    )
    .select()
  if (error) throw error
  return data || []
}

// =====================================================================
// ANALYTICS API
// =====================================================================
export async function fetchStudentAnalytics(studentId = null) {
  if (isSupabaseConfigured()) {
    try {
      let query = supabase.from('student_analytics').select('*')
      if (studentId) query = query.eq('student_id', studentId)
      const { data, error } = await query
      if (!error && data) return studentId ? data?.[0] || null : data
    } catch (err) {
      console.warn('fetchStudentAnalytics error:', err)
    }
  }

  // Fallback demo analytics
  if (studentId) {
    return {
      student_id: studentId,
      attendance_percent: 92,
      avg_quiz_percent: 88,
      avg_assignment_percent: 95,
      total_sessions: 14,
      present_count: 13,
      absent_count: 1,
      late_count: 0,
      quiz_count: 6,
      submission_count: 5,
      graded_count: 5,
    }
  }

  return SAMPLE_STUDENTS.map((s) => ({
    student_id: s.id,
    full_name: s.full_name,
    phone: s.phone,
    group_name: s.group_name,
    attendance_percent: 90,
    avg_quiz_percent: 85,
    avg_assignment_percent: 90,
    total_sessions: 12,
    present_count: 11,
    absent_count: 1,
    late_count: 0,
    quiz_count: 4,
    submission_count: 4,
    graded_count: 4,
  }))
}

// =====================================================================
// PROFILES / STUDENTS API
// =====================================================================
export async function fetchStudents() {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .order('created_at', { ascending: false })

      if (!error && data && data.length > 0) {
        return data.map((s) => ({
          id: s.id,
          full_name: s.full_name,
          phone: s.phone,
          parent_phone: s.parent_phone,
          year_id: s.year_id,
          group_name: s.group_name || '',
          group_id: s.group_id || null,
          governorate: s.governorate,
          is_active: s.is_active !== false,
          role: s.role || 'student',
          created_at: s.created_at,
        }))
      }
    } catch (err) {
      console.warn('fetchStudents error:', err)
    }
  }

  // Load from local storage or fallback sample
  try {
    const raw = localStorage.getItem('physics_hub_sample_students')
    if (raw) return JSON.parse(raw)
  } catch (_) {}

  return SAMPLE_STUDENTS
}

export async function updateOwnProfile(id, payload) {
  const updateData = {
    full_name: payload.fullName,
    phone: payload.phone,
    parent_phone: payload.parentPhone,
    governorate: payload.governorate,
    year_id: String(payload.yearId),
  }

  if (payload.groupName !== undefined) {
    updateData.group_name = payload.groupName
  }

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', id)
      .select()
    if (error) throw error
    return data?.[0]
  }

  return { id, ...updateData }
}

// =====================================================================
// BULK WHATSAPP MESSAGING REPORT
// =====================================================================
function normalizeReportRow(r) {
  return {
    student_id: r.student_id || r.id,
    full_name: r.full_name,
    phone: r.phone,
    parent_phone: r.parent_phone,
    year_id: r.year_id,
    group_name: r.group_name || r.groupName || 'عام',
    is_active: r.is_active !== false,
    total_sessions: r.total_sessions ?? 0,
    present_count: r.present_count ?? 0,
    absent_count: r.absent_count ?? 0,
    late_count: r.late_count ?? 0,
    attendance_percent: r.attendance_percent ?? 0,
    last_session_date: r.last_session_date ?? null,
    last_session_attendance: r.last_session_attendance ?? null,
    last_quiz_title: r.last_quiz_title ?? null,
    last_quiz_date: r.last_quiz_date ?? null,
    last_quiz_score: r.last_quiz_score ?? null,
    last_quiz_max: r.last_quiz_max ?? null,
    last_homework_title: r.last_homework_title ?? null,
    last_homework_status: r.last_homework_status ?? null,
    last_homework_score: r.last_homework_score ?? null,
    last_homework_max: r.last_homework_max ?? null,
  }
}

export async function fetchBulkMessagingReport({ yearId = null, groupName = null } = {}) {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('bulk_messaging_report', {
        target_year: yearId || null,
      })
      if (!error && Array.isArray(data) && data.length > 0) {
        let rows = data.map(normalizeReportRow)
        if (groupName && groupName !== 'all') {
          rows = rows.filter((r) => r.group_name === groupName)
        }
        return rows
      }
    } catch (err) {
      console.warn('bulk_messaging_report RPC unavailable, falling back to client assembly', err)
    }
  }

  // Fallback: build shape from existing student records
  const allStudents = await fetchStudents()
  let students = allStudents.filter((s) => !yearId || yearId === 'all' || s.year_id === yearId)
  if (groupName && groupName !== 'all') {
    students = students.filter((s) => (s.group_name || s.groupName) === groupName)
  }

  const analytics = await fetchStudentAnalytics()

  const rows = await Promise.all(
    students.map(async (s) => {
      const [grades, submissions, attendance] = await Promise.all([
        fetchGradesForStudent(s.id),
        fetchSubmissionsForStudent(s.id),
        fetchAttendanceForStudent(s.id),
      ])
      const a = (Array.isArray(analytics) ? analytics.find((x) => x.student_id === s.id) : null) || {}

      const lastQuiz = grades[0]
      const lastHw = submissions[0]
      const lastAtt = attendance[0]

      return normalizeReportRow({
        student_id: s.id,
        full_name: s.full_name,
        phone: s.phone,
        parent_phone: s.parent_phone,
        year_id: s.year_id,
        group_name: s.group_name || s.groupName || 'عام',
        is_active: s.is_active,
        total_sessions: a.total_sessions || 10,
        present_count: a.present_count || 9,
        absent_count: a.absent_count || 1,
        late_count: a.late_count || 0,
        attendance_percent: a.attendance_percent || 90,
        last_session_date: lastAtt?.session_date ?? '2024-10-15',
        last_session_attendance: lastAtt?.status ?? 'present',
        last_quiz_title: lastQuiz?.quizzes?.title ?? 'اختبار قانون أوم',
        last_quiz_date: lastQuiz?.quizzes?.quiz_date ?? '2024-10-10',
        last_quiz_score: lastQuiz?.score ?? 19,
        last_quiz_max: lastQuiz?.quizzes?.max_score ?? 20,
        last_homework_title: lastHw?.assignments?.title ?? 'واجب المقاومات',
        last_homework_status: lastHw?.status ?? 'graded',
        last_homework_score: lastHw?.score ?? 10,
        last_homework_max: lastHw?.assignments?.max_score ?? 10,
      })
    })
  )

  return rows
}
