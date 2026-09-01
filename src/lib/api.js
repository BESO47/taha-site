import { supabase, isSupabaseConfigured } from './supabase'
import { DEFAULT_GROUPS } from '../data/catalog'
import {
  gradeSubmissionAgainstKey, summarizeGrades, OPTION_LETTERS, romanNumeral,
} from './grading'

const MAX_SUBMISSION_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
const SUBMISSION_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const SUBMISSION_FILE_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp'])

function optionalHttpsUrl(value, fieldName) {
  if (!value) return null
  let parsed
  try { parsed = new URL(String(value)) } catch (_) { throw new Error(`${fieldName} must be a valid URL`) }
  if (parsed.protocol !== 'https:' && !(import.meta.env.DEV && parsed.protocol === 'http:')) {
    throw new Error(`${fieldName} must use HTTPS`)
  }
  return parsed.href
}

/**
 * Data access layer for Physics Hub platform.
 * Configured deployments fail visibly on backend errors; local demo data is
 * used only when Supabase is intentionally not configured.
 */

// =====================================================================
// BACKEND ERROR REPORTING
// =====================================================================
/** PostgREST error codes that mean "the RPC is not installed". */
const MISSING_FUNCTION_CODES = new Set(['PGRST202'])

export function isMissingBackendFunction(error) {
  if (!error) return false
  if (MISSING_FUNCTION_CODES.has(String(error.code))) return true
  const msg = String(error.message || '')
  // PostgREST wording when the RPC is not in the schema cache.
  // Do NOT treat every Postgres 42883 / "does not exist" as a missing RPC:
  // that code is also raised when pgcrypto's crypt() is not on the search_path
  // (the student password-change bug).
  return /could not find the function/i.test(msg)
}

/**
 * Turn a Supabase/PostgREST error into something a human can act on,
 * WITHOUT leaking SQL, table names, hints or connection details.
 *
 * @param {any} error   the raw error from supabase-js
 * @param {string} fallback  what to say when the cause is unknown
 * @returns {Error}
 */
export function describeBackendError(error, fallback = 'The request could not be completed') {
  if (!error) return new Error(fallback)

  const code = String(error.code || '')
  const raw = String(error.message || '')

  // Missing migration — the single most common production cause.
  if (isMissingBackendFunction(error)) {
    const err = new Error(
      `${fallback}: the database is missing a required function. ` +
      'Run the SQL migrations in Supabase (see DEPLOYMENT.md).'
    )
    err.code = 'MISSING_MIGRATION'
    return err
  }

  // Authorization raised by the database itself.
  if (code === '42501' || /permission denied|row-level security/i.test(raw)) {
    const err = new Error(raw && !/^permission denied/i.test(raw) ? raw : 'You are not authorized to perform this action')
    err.code = 'FORBIDDEN'
    return err
  }

  // Deliberate RAISE EXCEPTION messages from our own RPCs are safe to show.
  if (['22023', '23503', '23514', 'P0002', '28000'].includes(code) && raw) {
    const err = new Error(raw)
    err.code = code
    return err
  }

  const err = new Error(raw ? `${fallback}: ${raw}` : fallback)
  err.code = code || 'UNKNOWN'
  return err
}

// =====================================================================
// GROUPS API
// =====================================================================
/**
 * Groups as an ADMIN or a signed-in student sees them (full row).
 * Reads go through RLS: "groups: read" allows admins and active students.
 *
 * @param {{ yearId?: string|null }} opts
 */
export async function fetchGroups({ yearId = null } = {}) {
  if (isSupabaseConfigured()) {
    let query = supabase
      .from('groups')
      .select('*')
      .order('name', { ascending: true })
    if (yearId && yearId !== 'all') query = query.eq('year_id', String(yearId))
    const { data, error } = await query
    if (error) throw describeBackendError(error, 'Unable to load groups')
    return data || []
  }

  try {
    const raw = localStorage.getItem('physics_hub_groups')
    if (raw) {
      const rows = JSON.parse(raw)
      return yearId && yearId !== 'all'
        ? rows.filter((g) => String(g.year_id) === String(yearId))
        : rows
    }
  } catch (_) {}
  return yearId && yearId !== 'all'
    ? DEFAULT_GROUPS.filter((g) => String(g.year_id) === String(yearId))
    : DEFAULT_GROUPS
}

/**
 * Groups for the REGISTRATION form.
 *
 * The visitor filling in the signup form has no session yet, so they are
 * the Supabase `anon` role. `public.groups` is protected by RLS that only
 * admits `authenticated` admins/students, which means a plain
 * `from('groups').select('*')` returns an empty list AND NO ERROR — that
 * is exactly why the selector used to be empty for everybody.
 *
 * The signup form therefore reads through `list_registration_groups()`
 * (SECURITY DEFINER, anon-executable, returns only id / name / year_id /
 * description). Errors are propagated, never swallowed.
 *
 * @param {string|null} yearId  filter server-side by grade
 */
export async function fetchRegistrationGroups(yearId = null) {
  if (!isSupabaseConfigured()) {
    return fetchGroups({ yearId })
  }

  const { data, error } = await supabase.rpc('list_registration_groups', {
    p_year_id: yearId ? String(yearId) : null,
  })

  if (!error) {
    return (data || []).map((g) => ({
      id: g.id,
      name: g.name,
      year_id: g.year_id,
      description: g.description ?? null,
    }))
  }

  // Older database that has not run migration-groups-and-admin-editing.sql
  // yet: fall back to the table, which works for a signed-in reader.
  if (isMissingBackendFunction(error)) {
    const { data: rows, error: tableError } = await supabase
      .from('groups')
      .select('id, name, year_id, description')
      .order('name', { ascending: true })

    if (tableError) throw describeBackendError(tableError, 'Unable to load groups')

    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData?.session && !(rows || []).length) {
      // Anonymous + empty is indistinguishable from "RLS hid everything",
      // so say so instead of pretending there are no groups.
      const err = new Error(
        'Unable to load groups: the database is missing list_registration_groups(). ' +
        'Run migration-groups-and-admin-editing.sql in Supabase.'
      )
      err.code = 'MISSING_MIGRATION'
      throw err
    }

    return (rows || []).filter(
      (g) => !yearId || yearId === 'all' || String(g.year_id) === String(yearId)
    )
  }

  throw describeBackendError(error, 'Unable to load groups')
}

export async function createGroup({ name, yearId = '5', description = '' }) {
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ')
  if (!cleanName || cleanName.length > 80) throw new Error('Group name must be between 1 and 80 characters')

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('groups')
      .insert([{ name: cleanName, year_id: String(yearId), description: String(description || '').trim() || null }])
      .select()
    if (error) throw error
    return data?.[0]
  }

  const current = await fetchGroups()
  const newGroup = {
    id: `group_${Date.now()}`,
    name: cleanName,
    year_id: String(yearId),
    description,
    created_at: new Date().toISOString(),
  }
  try { localStorage.setItem('physics_hub_groups', JSON.stringify([...current, newGroup])) } catch (_) {}
  return newGroup
}

export async function deleteGroup(id) {
  if (isSupabaseConfigured()) {
    // Keep the denormalized compatibility name synchronized with the FK.
    const clear = await supabase
      .from('profiles')
      .update({ group_id: null, group_name: null })
      .eq('group_id', id)
    if (clear.error) throw clear.error
    const { error } = await supabase.from('groups').delete().eq('id', id)
    if (error) throw error
    return
  }

  const current = await fetchGroups()
  try { localStorage.setItem('physics_hub_groups', JSON.stringify(current.filter((group) => group.id !== id))) } catch (_) {}
}

export async function updateStudentGroup(studentId, group = null) {
  const groupId = group?.id || null
  const groupName = String(group?.name || '').trim() || null

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ group_id: groupId, group_name: groupName })
      .eq('id', studentId)
      .select()
    if (error) throw describeBackendError(error, 'Unable to save the selected group')
    return data?.[0]
  }

  try { localStorage.setItem(`student_group_${studentId}`, groupName || '') } catch (_) {}
  return { id: studentId, group_id: groupId, group_name: groupName }
}

// =====================================================================
// HOMEWORK SUBMISSIONS & ANSWER-KEY GRADING SYSTEM
// =====================================================================
// Every homework mark on the platform is produced by COMPARING THE
// STUDENT'S ANSWERS WITH THE TEACHER'S ANSWER KEY (see lib/grading.js).
// Handing work in is never a grade by itself: an empty or fully wrong
// paper scores 0%, and the score is weighted by each question's points.

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

  let serverResult = null

  // Configured deployments must use the authoritative RPC. Falling back to
  // a browser-computed score would let a student forge grading fields.
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('grade_lesson_homework', {
      p_lesson_id: lessonId,
      p_answers: answers,
    })
    if (error) {
      throw new Error('Server-side lesson grading is unavailable. Apply homework-grading.sql.')
    }
    const row = Array.isArray(data) ? data[0] : data
    serverResult = {
      earnedPoints: Number(row?.score) || 0,
      totalPoints: Number(row?.total_points) || 0,
      totalQuestions: Number(row?.total_questions) || questionCount,
      correctCount: Number(row?.correct_count) || 0,
      incorrectCount: Number(row?.incorrect_count) || 0,
      unansweredCount: Number(row?.unanswered_count) || 0,
      percentage: Math.round(Number(row?.percentage)) || 0,
      breakdown: row?.breakdown || [],
      hasAnswerKey: Number(row?.total_points) > 0,
    }
  }

  const final = serverResult || result
  const localResult = {
    id: `sub_${Date.now()}`,
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

  if (!isSupabaseConfigured()) {
    try {
      const key = `hw_sub_${lessonId}_${studentId}`
      localStorage.setItem(key, JSON.stringify(localResult))
      const allKey = 'physics_hub_all_hw_submissions'
      const allRaw = JSON.parse(localStorage.getItem(allKey) || '[]')
      const filtered = allRaw.filter((item) => !(item.lessonId === lessonId && item.studentId === studentId))
      localStorage.setItem(allKey, JSON.stringify([localResult, ...filtered]))
    } catch (_) {}
  }

  return localResult
}

/**
 * Re-mark every stored submission of a lesson against the CURRENT answer
 * key. Used by the teacher after fixing / publishing the model answers.
 *
 * @returns {{ updated:number, failed:number, results:Array, stats:object }}
 */
export async function regradeLessonSubmissions({ lessonId, questions = [], modelAnswers = {} }) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('regrade_lesson_homework', { p_lesson_id: lessonId })
    if (error) throw error
    const results = (data || []).map((row) => ({
      studentId: row.student_id,
      score: Number(row.score) || 0,
      earnedPoints: Number(row.score) || 0,
      correctCount: Number(row.correct_count) || 0,
      incorrectCount: Number(row.incorrect_count) || 0,
      percentage: Number(row.percentage) || 0,
    }))
    return { updated: results.length, failed: 0, results, stats: summarizeGrades(results) }
  }

  const rows = await fetchHomeworkSubmissionsForLesson(lessonId)
  const results = []
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
    } catch (_) {
      failed += 1
    }
  }
  return { updated: results.length, failed, results, stats: summarizeGrades(results) }
}

/**
 * Fetch all submissions for a specific lesson (Admin statistical table).
 */
export async function fetchHomeworkSubmissionsForLesson(lessonId) {
  if (!lessonId) return []

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('homework_submissions')
      .select('*, profiles:student_id (id, full_name, phone, parent_phone, year_id, group_name)')
      .eq('lesson_id', lessonId)
      .order('submitted_at', { ascending: false })
    if (error) throw error
    return (data || []).map((row) => normalizeHomeworkSubmissionRow(row, {
      studentName: row.profiles?.full_name || 'طالب',
      phone: row.profiles?.phone || '',
      parentPhone: row.profiles?.parent_phone || '',
      groupName: row.profiles?.group_name || 'عام',
      yearId: row.profiles?.year_id || '5',
    }))
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

// =====================================================================
// VIDEOS API
// =====================================================================
export async function fetchVideos({ yearId = null, publishedOnly = true } = {}) {
  if (!isSupabaseConfigured()) return []
  let query = supabase.from('videos').select('*').order('sort_order', { ascending: true })
  if (publishedOnly) query = query.eq('is_published', true)
  if (yearId && yearId !== 'all') query = query.eq('year_id', String(yearId))
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function createVideo(payload) {
  const { data, error } = await supabase
    .from('videos')
    .insert([
      {
        title: payload.title,
        description: payload.description || null,
        youtube_url: optionalHttpsUrl(payload.youtubeUrl, 'YouTube URL'),
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
      youtube_url: optionalHttpsUrl(payload.youtubeUrl, 'YouTube URL'),
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
  if (!isSupabaseConfigured()) return []
  let query = supabase.from('quizzes').select('*').order('quiz_date', { ascending: false })
  if (yearId && yearId !== 'all') query = query.eq('year_id', String(yearId))
  const { data, error } = await query
  if (error) throw error
  return data || []
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

// =====================================================================
// HOMEWORK ENTRIES  (Unified "Homework" module — formerly "Assignments")
// =====================================================================
// A homework entry lives in the `assignments` table (extended with a
// `questions` JSONB column + computed `total_points`) so the existing
// `submissions` table, RLS policies and grading guard triggers keep
// working unchanged. Each question = { id, question, options[4], answer,
// points }. Total points = sum of question points (fallback: max_score).

/**
 * Total marks of a homework entry.
 *
 * A question that carries subpoints is worth the SUM of its subpoint
 * points — its own `points` value is ignored, so converting a question
 * into a nested one can never inflate (or double count) the total.
 * Mirrors `ph_mark_answers()` in homework-subpoints.sql.
 */
export function computeHomeworkTotalPoints(questions = []) {
  const arr = Array.isArray(questions) ? questions : []
  if (arr.length === 0) return 0
  let sum = 0
  for (const q of arr) {
    const subs = Array.isArray(q?.subpoints) ? q.subpoints : []
    if (subs.length) {
      sum += subs.reduce((acc, sp) => acc + (Number(sp?.points) > 0 ? Number(sp.points) : 1), 0)
    } else {
      sum += Number(q?.points) || 0
    }
  }
  return Math.round(sum * 100) / 100
}

/**
 * Canonical shape written to `assignments.questions`.
 *
 * Every subpoint is a COMPLETE MCQ — text, four options, one correct
 * answer and its own points — so an incomplete subpoint can never reach
 * the database. A question keeps its own options/answer only when it has
 * no subpoints, exactly as the editor presents it.
 */
function canonicalizeQuestions(questions = []) {
  return (Array.isArray(questions) ? questions : []).map((q) => {
    const subs = Array.isArray(q?.subpoints) ? q.subpoints.filter(Boolean) : []
    const base = {
      id: q.id,
      // `question` is the canonical field; the marker also accepts the
      // historical `text` so previously stored homework keeps working.
      question: String(q.question ?? q.text ?? '').trim(),
      points: Number(q.points) > 0 ? Number(q.points) : 1,
    }

    if (subs.length) {
      base.subpoints = subs.map((sp, i) => ({
        id: sp.id || `sp_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
        question: String(sp.question ?? sp.text ?? '').trim(),
        options: (Array.isArray(sp.options) ? sp.options : []).slice(0, 4).map(
          (o, oi) => String(o ?? '').trim() || `${OPTION_LETTERS[oi]}) `
        ),
        answer: String(sp.answer ?? sp.correctAnswer ?? '').trim(),
        points: Number(sp.points) > 0 ? Number(sp.points) : 1,
      }))
    } else {
      if (Array.isArray(q.options) && q.options.length) {
        base.options = q.options.slice(0, 4).map(
          (o, oi) => String(o ?? '').trim() || `${OPTION_LETTERS[oi]}) `
        )
      }
      const answer = String(q.answer ?? q.correctAnswer ?? '').trim()
      if (answer) base.answer = answer
    }
    return base
  })
}

/**
 * Client-side guard used by the admin editor before saving: an incomplete
 * question or subpoint is rejected here so it never reaches the database,
 * and the marking engine never has to cope with a half-built MCQ.
 *
 * @returns {string|null} a human readable problem, or null when valid
 */
export function validateHomeworkQuestions(questions = [], lang = 'en') {
  const ar = lang === 'ar'
  const list = Array.isArray(questions) ? questions : []
  if (!list.length) return ar ? 'أضف سؤالاً واحداً على الأقل.' : 'Add at least one question.'

  for (let i = 0; i < list.length; i += 1) {
    const q = list[i]
    const n = i + 1
    if (!String(q.question ?? q.text ?? '').trim()) {
      return ar ? `السؤال ${n}: اكتب نص السؤال.` : `Question ${n}: the question text is required.`
    }

    const subs = Array.isArray(q.subpoints) ? q.subpoints.filter(Boolean) : []
    if (!subs.length) {
      if (!(Number(q.points) > 0)) {
        return ar ? `السؤال ${n}: الدرجة يجب أن تكون أكبر من صفر.` : `Question ${n}: points must be greater than zero.`
      }
      if (!String(q.answer ?? q.correctAnswer ?? '').trim()) {
        return ar ? `السؤال ${n}: اختر الإجابة الصحيحة.` : `Question ${n}: select the correct answer.`
      }
      continue
    }

    for (let j = 0; j < subs.length; j += 1) {
      const sp = subs[j]
      const label = romanNumeral(j + 1)
      if (!String(sp.question ?? sp.text ?? '').trim()) {
        return ar ? `السؤال ${n} (${label}): اكتب نص النقطة الفرعية.` : `Question ${n} (${label}): the subpoint text is required.`
      }
      const opts = Array.isArray(sp.options) ? sp.options : []
      if (opts.length !== 4 || opts.some((o) => !String(o ?? '').trim())) {
        return ar
          ? `السؤال ${n} (${label}): أكمل الاختيارات الأربعة.`
          : `Question ${n} (${label}): all four options are required.`
      }
      if (!['A', 'B', 'C', 'D'].includes(String(sp.answer ?? '').trim())) {
        return ar
          ? `السؤال ${n} (${label}): حدد الإجابة الصحيحة.`
          : `Question ${n} (${label}): select exactly one correct answer.`
      }
      if (!(Number(sp.points) > 0)) {
        return ar
          ? `السؤال ${n} (${label}): الدرجة يجب أن تكون أكبر من صفر.`
          : `Question ${n} (${label}): points must be greater than zero.`
      }
    }
  }
  return null
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
    // Explanation video: unlocked for the student only once their
    // submission is graded (see pages/HomeworkPage.jsx).
    explanationVideoUrl: row.explanation_video_url || '',
    hasExplanationVideo: row.has_explanation_video ?? Boolean(row.explanation_video_url),
    explanationVideoTitle: row.explanation_video_title || '',
    isPublished: row.is_published !== false,
    groupName: row.group_name || '',
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

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
      explanation_video_url: 'https://www.youtube.com/watch?v=8j0UDid94kU',
      explanation_video_title: 'شرح حل واجب التيار الكهربي وقانون أوم',
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
      explanation_video_url: 'https://www.youtube.com/watch?v=8j0UDid94kU',
      explanation_video_title: 'Ohm\'s Law homework walkthrough',
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
    let query = supabase
      .from('homework_catalog')
      .select('*')
      .order('created_at', { ascending: false })
    if (yearId && yearId !== 'all') query = query.eq('year_id', String(yearId))
    if (groupName && groupName !== 'all') query = query.eq('group_name', groupName)
    if (publishedOnly) query = query.eq('is_published', true)

    const { data, error } = await query
    if (error) throw error
    return (data || []).map(normalizeHomeworkEntry)
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
  const flatQuestions = canonicalizeQuestions(questions)
  const row = {
    title: String(payload.title || '').trim(),
    description: String(payload.description || '').trim() || null,
    year_id: String(payload.yearId || '5'),
    branch: String(payload.branch || '').trim() || null,
    due_date: payload.dueDate || null,
    max_score: totalPoints || Number(payload.maxScore) || 100,
    total_points: totalPoints || null,
    questions: flatQuestions,
    attachment_url: optionalHttpsUrl(payload.attachmentUrl, 'Attachment URL'),
    explanation_video_url: optionalHttpsUrl(payload.explanationVideoUrl, 'Explanation video URL'),
    explanation_video_title: String(payload.explanationVideoTitle || '').trim() || null,
    is_published: payload.isPublished !== false,
    group_name: payload.groupName || null,
  }

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.from('assignments').insert([row]).select('*')
    if (error) throw error
    const entry = normalizeHomeworkEntry(data?.[0])
    // Multi-group targeting is a real backend write: if it fails the
    // admin has to know, otherwise the homework silently reaches nobody.
    if (payload.groupIds?.length) {
      await setAssignmentGroups(entry.id, payload.groupIds)
    }
    entry.groupIds = payload.groupIds || []
    return entry
  }

  // LocalStorage fallback
  const current = await fetchHomeworkEntries()
  const newEntry = { id: `hw_${Date.now()}`, ...row, created_at: new Date().toISOString() }
  const updated = [newEntry, ...current.map((e) => ({
    id: e.id, title: e.title, description: e.description, year_id: e.yearId,
    branch: e.branch, due_date: e.dueDate, max_score: e.maxScore, total_points: e.totalPoints,
    questions: e.questions, attachment_url: e.attachmentUrl,
    explanation_video_url: e.explanationVideoUrl, explanation_video_title: e.explanationVideoTitle,
    is_published: e.isPublished,
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
  const flatQuestions = canonicalizeQuestions(questions)
  const row = {
    title: String(payload.title || '').trim(),
    description: String(payload.description || '').trim() || null,
    year_id: String(payload.yearId || '5'),
    branch: String(payload.branch || '').trim() || null,
    due_date: payload.dueDate || null,
    max_score: totalPoints || Number(payload.maxScore) || 100,
    total_points: totalPoints || null,
    questions: flatQuestions,
    attachment_url: optionalHttpsUrl(payload.attachmentUrl, 'Attachment URL'),
    explanation_video_url: optionalHttpsUrl(payload.explanationVideoUrl, 'Explanation video URL'),
    explanation_video_title: String(payload.explanationVideoTitle || '').trim() || null,
    is_published: payload.isPublished !== false,
    group_name: payload.groupName || null,
  }

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.from('assignments').update(row).eq('id', id).select('*')
    if (error) throw error
    const entry = normalizeHomeworkEntry(data?.[0])
    // Update multi-group targeting (errors surface, never swallowed).
    if (payload.groupIds !== undefined) {
      await setAssignmentGroups(id, payload.groupIds || [])
    }
    entry.groupIds = payload.groupIds || []
    return entry
  }

  const current = await fetchHomeworkEntries()
  const updated = current.map((e) => (e.id === id
    ? { id: e.id, ...row, created_at: e.createdAt }
    : { id: e.id, title: e.title, description: e.description, year_id: e.yearId, branch: e.branch, due_date: e.dueDate, max_score: e.maxScore, total_points: e.totalPoints, questions: e.questions, attachment_url: e.attachmentUrl, explanation_video_url: e.explanationVideoUrl, explanation_video_title: e.explanationVideoTitle, is_published: e.isPublished, group_name: e.groupName, created_at: e.createdAt }))
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
      attachment_url: e.attachmentUrl, explanation_video_url: e.explanationVideoUrl,
      explanation_video_title: e.explanationVideoTitle, is_published: e.isPublished,
      group_name: e.groupName, created_at: e.createdAt,
    }))))
  } catch (_) {}
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
    const { data, error } = await supabase
      .from('submissions')
      .select('*, profiles:student_id (id, full_name, phone, parent_phone, group_name, year_id)')
      .eq('assignment_id', assignmentId)
      .order('submitted_at', { ascending: false })
    if (error) throw error
    return (data || []).map((row) => normalizeAssignmentSubmission(row, entry))
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
  const { data, error } = await supabase
    .from('submissions')
    .upsert(payload, { onConflict: 'assignment_id,student_id' })
    .select()
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
    const { data, error } = await supabase.rpc('grade_assignment_submission', {
      p_assignment_id: assignmentId,
      p_answers: answers,
      p_content: content,
      p_file_url: fileUrl,
    })
    if (error) throw new Error(error.message || 'Server-side grading failed')
    const row = Array.isArray(data) ? data[0] : data
    return {
      totalQuestions: Number(row?.total_questions) || 0,
      correctCount: Number(row?.correct_count) || 0,
      incorrectCount: Number(row?.incorrect_count) || 0,
      unansweredCount: Number(row?.unanswered_count) || 0,
      earnedPoints: Number(row?.score) || 0,
      totalPoints: Number(row?.total_points) || 0,
      percentage: Math.round(Number(row?.percentage)) || 0,
      breakdown: row?.breakdown || [],
      gradedOnServer: true,
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
 * ================= ADMIN: change ONE submitted answer ================
 *
 * The whole flow is server-side: the RPC verifies `is_admin()` in the
 * database, rewrites only the targeted question/subpoint answer, re-marks
 * the entire paper and records the change in `submission_answer_edits`.
 *
 * The client therefore never recomputes a score and never posts one — a
 * student replaying this call is rejected by the database itself.
 *
 * @param {{ submissionId:string, questionId:string,
 *           subpointId?:string|null, answer:string }} input
 * @returns {Promise<{ score:number, totalPoints:number, percentage:number,
 *   correctCount:number, incorrectCount:number, status:string,
 *   answers:object, breakdown:Array, previousAnswer:string }>}
 */
export async function adminUpdateSubmissionAnswer({ submissionId, questionId, subpointId = null, answer }) {
  if (!submissionId) throw new Error('A submission is required')
  if (!questionId) throw new Error('A question is required')
  if (answer === undefined || answer === null || String(answer).trim() === '') {
    throw new Error('A new answer is required')
  }

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('admin_update_submission_answer', {
      p_submission_id: submissionId,
      p_question_id: String(questionId),
      p_subpoint_id: subpointId ? String(subpointId) : null,
      p_new_answer: String(answer),
    })
    if (error) {
      const described = describeBackendError(error, "Failed to update the student's answer")
      // Two deployment states make the editor refuse to save: the function is
      // not installed, or it is installed but not granted. Both are fixed by
      // the same two files, so say that instead of leaving a bare
      // "permission denied" for the person trying to correct a grade.
      if (described.code === 'MISSING_MIGRATION' || described.code === 'FORBIDDEN') {
        described.message = `${described.message} The answer editor needs admin_update_submission_answer: apply homework-subpoints.sql and then migration-groups-and-admin-editing.sql in the Supabase SQL editor, and reload the PostgREST schema cache.`
      }
      throw described
    }
    const row = Array.isArray(data) ? data[0] : data
    if (!row?.ok) throw new Error('The answer could not be changed')

    return {
      editId: row.edit_id,
      previousAnswer: row.previous_answer ?? '',
      newAnswer: row.new_answer,
      score: Number(row.score) || 0,
      totalPoints: Number(row.total_points) || 0,
      correctCount: Number(row.correct_count) || 0,
      incorrectCount: Number(row.incorrect_count) || 0,
      unansweredCount: Number(row.unanswered_count) || 0,
      percentage: Math.round(Number(row.percentage)) || 0,
      status: row.status,
      answers: row.answers || {},
      breakdown: row.breakdown || [],
    }
  }

  throw new Error('Changing a submitted answer requires Supabase')
}

/**
 * Audit trail for a submission: who changed which answer, from what to
 * what, and when. Read-only, and visible to administrators only — the
 * table has no write policy and its rows are append-only.
 */
export async function fetchSubmissionAnswerEdits(submissionId) {
  if (!submissionId) return []
  if (!isSupabaseConfigured()) return []

  const { data, error } = await supabase
    .from('submission_answer_edits')
    .select('id, question_id, subpoint_id, previous_answer, new_answer, score_before, score_after, created_at, changed_by, editor:changed_by (full_name)')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    questionId: row.question_id,
    subpointId: row.subpoint_id,
    previousAnswer: row.previous_answer || '',
    newAnswer: row.new_answer,
    scoreBefore: row.score_before == null ? null : Number(row.score_before),
    scoreAfter: row.score_after == null ? null : Number(row.score_after),
    changedBy: row.changed_by,
    editorName: row.editor?.full_name || '',
    createdAt: row.created_at,
  }))
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

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('regrade_assignment', { p_assignment_id: entry.id })
    if (error) throw error
    const results = (data || []).map((row) => ({
      studentId: row.student_id,
      earnedPoints: Number(row.score) || 0,
      score: Number(row.score) || 0,
      correctCount: Number(row.correct_count) || 0,
      incorrectCount: Number(row.incorrect_count) || 0,
      percentage: Number(row.percentage) || 0,
    }))
    return { graded: results.length, skipped: 0, failed: 0, rows: results, stats: summarizeGrades(results) }
  }

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
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('student_id', studentId)
      .order('submitted_at', { ascending: false })
    if (error) throw error
    return (data || []).map((row) => normalizeAssignmentSubmission(row))
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

export async function uploadSubmissionFile(studentId, file) {
  if (!isSupabaseConfigured()) throw new Error('File uploads require a configured Supabase project')
  if (!file || file.size <= 0 || file.size > MAX_SUBMISSION_FILE_BYTES) {
    throw new Error('The file must be non-empty and no larger than 10 MB')
  }
  const extension = String(file.name || '').split('.').pop()?.toLowerCase()
  if (!SUBMISSION_FILE_TYPES.has(file.type) || !SUBMISSION_FILE_EXTENSIONS.has(extension)) {
    throw new Error('Only PDF, JPEG, PNG and WebP files are accepted')
  }

  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const path = `${studentId}/${randomPart}.${extension}`
  const { error } = await supabase.storage.from('submissions').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  })
  if (error) throw error

  // The bucket is private. Store the object path, never a permanent public URL.
  return path
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
    let query = supabase.from('student_analytics').select('*')
    if (studentId) query = query.eq('student_id', studentId)
    const { data, error } = await query
    if (error) throw error
    return studentId ? data?.[0] || null : data || []
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

  const { SAMPLE_STUDENTS } = await import('../data/dummyData.js')
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
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, parent_phone, year_id, group_name, group_id, governorate, is_active, role, created_at')
      .eq('role', 'student')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data || []).map((student) => ({
      ...student,
      group_name: student.group_name || '',
      group_id: student.group_id || null,
      is_active: student.is_active !== false,
    }))
  }

  try {
    const raw = localStorage.getItem('physics_hub_sample_students')
    if (raw) return JSON.parse(raw)
  } catch (_) {}
  return (await import('../data/dummyData.js')).SAMPLE_STUDENTS
}

export async function updateOwnProfile(id, payload) {
  const updateData = {
    full_name: String(payload.fullName || '').trim().replace(/\s+/g, ' '),
    phone: String(payload.phone || '').trim(),
    parent_phone: String(payload.parentPhone || '').trim(),
    governorate: String(payload.governorate || '').trim(),
  }
  if (updateData.full_name.length < 2 || updateData.full_name.length > 120) {
    throw new Error('Name must be between 2 and 120 characters')
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
    const { data, error } = await supabase.rpc('bulk_messaging_report', {
      target_year: yearId && yearId !== 'all' ? yearId : null,
    })
    if (error) throw new Error('Bulk report RPC unavailable. Apply bulk-messaging.sql.')
    let rows = (data || []).map(normalizeReportRow)
    if (groupName && groupName !== 'all') rows = rows.filter((row) => row.group_name === groupName)
    return rows
  }

  // Offline demo fallback. Production uses the set-based RPC above and
  // therefore avoids this per-student assembly path.
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

// =====================================================================
// PAGINATED STUDENT LISTING
// =====================================================================
export async function fetchStudentsPaginated({ page = 1, pageSize = 20, search = null, yearId = null, groupId = null, isActive = null } = {}) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('fetch_students_paginated', {
      p_page: page,
      p_page_size: pageSize,
      p_search: search || null,
      p_year_id: yearId && yearId !== 'all' ? String(yearId) : null,
      p_group_id: groupId && groupId !== 'all' && groupId !== 'none' ? groupId : null,
      p_is_active: isActive != null ? isActive : null,
    })
    if (error) throw describeBackendError(error, 'Unable to load the student list')
    return data || { data: [], total: 0, page: 1, pageSize, totalPages: 0 }
  }

  // Fallback: client-side pagination
  const all = await fetchStudents()
  let filtered = all
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter((s) =>
      s.full_name?.toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q) ||
      (s.phone || '').includes(search)
    )
  }
  if (yearId && yearId !== 'all') filtered = filtered.filter((s) => s.year_id === yearId)
  if (groupId && groupId !== 'all' && groupId !== 'none') filtered = filtered.filter((s) => s.group_id === groupId)
  if (isActive != null) filtered = filtered.filter((s) => s.is_active === isActive)

  const total = filtered.length
  const totalPages = Math.ceil(total / pageSize)
  const start = (page - 1) * pageSize
  return {
    data: filtered.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  }
}

// =====================================================================
// ADMIN STUDENT MANAGEMENT
// =====================================================================
export async function adminUpdateStudent(studentId, payload) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('admin_update_student', {
      target_user_id: studentId,
      p_full_name: payload.fullName || null,
      p_email: payload.email || null,
      p_phone: payload.phone || null,
      p_parent_phone: payload.parentPhone || null,
      p_year_id: payload.yearId || null,
      p_group_id: payload.groupId || null,
      p_governorate: payload.governorate || null,
      p_is_active: payload.isActive != null ? payload.isActive : null,
    })
    if (error) throw describeBackendError(error, "Unable to save the student's profile")
    return data
  }
  return { id: studentId, ...payload }
}

export async function adminSetStudentPassword(studentId, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }
  if (newPassword.length > 72) {
    throw new Error('Password must be at most 72 characters')
  }
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('admin_set_student_password', {
      target_user_id: studentId,
      new_password: newPassword,
    })
    if (error) {
      const described = describeBackendError(error, "Unable to change the student's password")
      const raw = String(error.message || '')
      if (described.code === 'MISSING_MIGRATION') {
        described.message =
          `${described.message} Apply migration-features.sql and then ` +
          'migration-groups-and-admin-editing.sql in the Supabase SQL editor, ' +
          'and reload the PostgREST schema cache.'
      } else if (/crypt|gen_salt/i.test(raw)) {
        described.message =
          "Unable to change the student's password: password hashing is unavailable. " +
          'Re-apply migration-groups-and-admin-editing.sql in the Supabase SQL editor ' +
          '(it installs pgcrypto on the function search_path).'
      } else if (/permission denied for (table users|schema auth)/i.test(raw)) {
        described.message =
          "Unable to change the student's password: the database role cannot update auth.users. " +
          'Run the migration as the postgres role in the Supabase SQL editor.'
      }
      throw described
    }
    return data
  }
  throw new Error('Password reset requires Supabase')
}

export async function adminInitiatePasswordReset(studentId) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('admin_initiate_password_reset', {
      target_user_id: studentId,
    })
    if (error) throw describeBackendError(error, 'Unable to start the password reset')
    return data
  }
  throw new Error('Password reset requires Supabase')
}

// =====================================================================
// ATTENDANCE CANCELLATION
// =====================================================================
export async function cancelAttendance(studentId, sessionDate) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('cancel_attendance', {
      p_student_id: studentId,
      p_session_date: sessionDate,
    })
    if (error) throw describeBackendError(error, 'Unable to cancel the attendance record')
    return data
  }
  return false
}

// =====================================================================
// BULK STUDENT OPERATIONS
// =====================================================================
export async function bulkUpdateStudentGroup(studentIds, groupId) {
  if (!studentIds?.length) return 0
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('bulk_update_student_group', {
      p_student_ids: studentIds,
      p_group_id: groupId,
    })
    if (error) throw describeBackendError(error, "Unable to update the selected students' group")
    return data || 0
  }
  return 0
}

export async function bulkUpdateStudentStatus(studentIds, isActive) {
  if (!studentIds?.length) return 0
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('bulk_update_student_status', {
      p_student_ids: studentIds,
      p_is_active: isActive,
    })
    if (error) throw describeBackendError(error, "Unable to update the selected students' status")
    return data || 0
  }
  return 0
}

// =====================================================================
// MULTI-GROUP HOMEWORK ASSIGNMENT
// =====================================================================
export async function setAssignmentGroups(assignmentId, groupIds) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('set_assignment_groups', {
      p_assignment_id: assignmentId,
      p_group_ids: groupIds || [],
    })
    if (error) throw describeBackendError(error, 'Unable to save the homework groups')
    return data || 0
  }
  return 0
}

export async function getAssignmentGroups(assignmentId) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('get_assignment_groups', {
      p_assignment_id: assignmentId,
    })
    if (error) throw describeBackendError(error, 'Unable to load the homework groups')
    return data || []
  }
  return []
}

// =====================================================================
// STUDENT HOMEWORK FEED  (used by pages/HomeworkPage.jsx)
// =====================================================================
// One call that returns every homework entry a student can see together
// with their own submission, the marking result and whether the
// explanation video has been unlocked (= the submission is graded).

/** Status of one homework entry for one student. */
export function deriveHomeworkStatus(entry, submission) {
  if (!submission) return 'pending'
  if (submission.status === 'graded' && submission.score != null) return 'graded'
  if (submission.status === 'returned') return 'returned'
  return 'submitted'
}

/**
 * @param {{ studentId:string, yearId?:string|null, groupName?:string|null }} opts
 * @returns {Promise<Array<{ entry, submission, status, isGraded, hasVideo,
 *                           videoUnlocked, percentage, correctCount, incorrectCount }>>}
 */
export async function fetchStudentHomeworkFeed({ studentId, yearId = null, groupName = null } = {}) {
  const entries = await fetchHomeworkEntries({ yearId, publishedOnly: true })

  const submissions = studentId ? await fetchSubmissionsForStudent(studentId) : []
  const byAssignment = new Map()
  submissions.forEach((s) => byAssignment.set(String(s.assignment_id), s))

  return entries
    // A homework entry is either general (no group) or assigned to the
    // student's own group.
    .filter((e) => !e.groupName || !groupName || e.groupName === groupName)
    .map((entry) => {
      const raw = byAssignment.get(String(entry.id)) || null
      const submission = raw ? normalizeAssignmentSubmission(raw, entry) : null
      const status = deriveHomeworkStatus(entry, submission)
      const isGraded = status === 'graded'
      const hasVideo = entry.hasExplanationVideo ?? Boolean(entry.explanationVideoUrl)

      return {
        entry,
        submission,
        status,
        isGraded,
        hasVideo,
        // GATED ACCESS: the explanation video only opens once the work is graded.
        videoUnlocked: hasVideo && isGraded,
        percentage: submission?.percentage ?? null,
        correctCount: submission?.correctCount ?? null,
        incorrectCount: submission?.incorrectCount ?? null,
        score: submission?.score ?? null,
        totalPoints: entry.totalPoints || entry.maxScore || 0,
        submittedAt: submission?.submitted_at || null,
        gradedAt: submission?.graded_at || null,
      }
    })
}
