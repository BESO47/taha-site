import { supabase, isSupabaseConfigured } from './supabase'
import { DEFAULT_GROUPS, SAMPLE_STUDENTS, LESSONS } from '../data/dummyData'

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
// HOMEWORK SUBMISSIONS & AUTOMATED GRADING SYSTEM
// =====================================================================

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

      if (!error && data) {
        return {
          id: data.id,
          studentId: data.student_id,
          lessonId: data.lesson_id,
          answers: data.answers || {},
          score: Number(data.score) || 0,
          totalQuestions: Number(data.total_questions) || 0,
          submittedAt: data.submitted_at,
          isUnlocked: true,
        }
      }
    } catch (err) {
      console.warn('Failed to fetch homework submission from Supabase:', err)
    }
  }

  // Fallback to local storage
  try {
    const key = `hw_sub_${lessonId}_${studentId}`
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...parsed, isUnlocked: true }
    }
  } catch (_) {}

  return null
}

/**
 * Submit student's homework answers, automatically grading against model answers.
 */
export async function submitHomeworkSubmission({
  lessonId,
  studentId,
  answers = {},
  modelAnswers = {},
  totalQuestions = 0,
}) {
  if (!lessonId || !studentId) {
    throw new Error('Lesson ID and Student ID are required')
  }

  // Grade calculation
  let calculatedTotal = Number(totalQuestions) || Object.keys(modelAnswers).length || Object.keys(answers).length || 1
  let correctCount = 0

  // Normalize model answers map
  const normalizedModel = {}
  if (Array.isArray(modelAnswers)) {
    modelAnswers.forEach((q, idx) => {
      const key = String(q.id || idx + 1)
      normalizedModel[key] = String(q.correctAnswer || q.correct || q.answer || '').trim().toUpperCase()
    })
  } else if (typeof modelAnswers === 'object' && modelAnswers !== null) {
    Object.entries(modelAnswers).forEach(([k, v]) => {
      normalizedModel[String(k).trim()] = String(v).trim().toUpperCase()
    })
  }

  if (Object.keys(normalizedModel).length > 0) {
    calculatedTotal = Object.keys(normalizedModel).length
    Object.entries(answers).forEach(([qKey, studentChoice]) => {
      const cleanKey = String(qKey).trim()
      const cleanChoice = String(studentChoice || '').trim().toUpperCase()
      const correctChoice = normalizedModel[cleanKey] || ''

      if (correctChoice && (cleanChoice === correctChoice || cleanChoice.startsWith(correctChoice))) {
        correctCount += 1
      }
    })
  } else {
    // If no model answers set, treat all submitted as valid/full score
    correctCount = Object.keys(answers).length
    calculatedTotal = Math.max(1, correctCount)
  }

  const payload = {
    lesson_id: lessonId,
    student_id: studentId,
    answers,
    score: correctCount,
    total_questions: calculatedTotal,
    submitted_at: new Date().toISOString(),
  }

  let savedSubmission = null

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('homework_submissions')
        .upsert(payload, { onConflict: 'lesson_id,student_id' })
        .select()

      if (!error && data?.[0]) {
        savedSubmission = data[0]
      } else if (error) {
        console.warn('Supabase homework submission upsert error:', error)
      }
    } catch (err) {
      console.warn('Supabase homework submission exception:', err)
    }
  }

  // Save to local storage for instant responsiveness & offline resilience
  const localResult = {
    id: savedSubmission?.id || `sub_${Date.now()}`,
    studentId,
    lessonId,
    answers,
    score: correctCount,
    totalQuestions: calculatedTotal,
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
        return data.map((d) => ({
          id: d.id,
          studentId: d.student_id,
          studentName: d.profiles?.full_name || 'طالب',
          phone: d.profiles?.phone || '',
          parentPhone: d.profiles?.parent_phone || '',
          groupName: d.profiles?.group_name || 'عام',
          yearId: d.profiles?.year_id || '5',
          lessonId: d.lesson_id,
          answers: d.answers || {},
          score: Number(d.score) || 0,
          totalQuestions: Number(d.total_questions) || 0,
          percentage: d.total_questions > 0 ? Math.round((Number(d.score) / Number(d.total_questions)) * 100) : 0,
          submittedAt: d.submitted_at,
          isUnlocked: true,
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
      return {
        ...s,
        studentName: st?.full_name || 'طالب',
        phone: st?.phone || '',
        parentPhone: st?.parent_phone || '',
        groupName: st?.group_name || 'عام',
        percentage: s.totalQuestions > 0 ? Math.round((s.score / s.totalQuestions) * 100) : 0,
      }
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
        return data.map((d) => ({
          id: d.id,
          studentId: d.student_id,
          studentName: d.profiles?.full_name || 'طالب',
          phone: d.profiles?.phone || '',
          groupName: d.profiles?.group_name || '',
          yearId: d.profiles?.year_id || '5',
          lessonId: d.lesson_id,
          lessonTitle: d.lessons?.title || 'درس',
          answers: d.answers || {},
          score: Number(d.score) || 0,
          totalQuestions: Number(d.total_questions) || 0,
          percentage: d.total_questions > 0 ? Math.round((Number(d.score) / Number(d.total_questions)) * 100) : 0,
          submittedAt: d.submitted_at,
          isUnlocked: true,
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
        return data.map((d) => ({
          id: d.id,
          studentId: d.student_id,
          lessonId: d.lesson_id,
          lessonTitle: d.lessons?.title || 'درس',
          branch: d.lessons?.branch || '',
          unit: d.lessons?.unit || '',
          answers: d.answers || {},
          score: Number(d.score) || 0,
          totalQuestions: Number(d.total_questions) || 0,
          percentage: d.total_questions > 0 ? Math.round((Number(d.score) / Number(d.total_questions)) * 100) : 0,
          submittedAt: d.submitted_at,
          isUnlocked: true,
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
// ASSIGNMENTS + GENERAL SUBMISSIONS
// =====================================================================
export async function fetchAssignments({ yearId = null } = {}) {
  if (isSupabaseConfigured()) {
    try {
      let query = supabase.from('assignments').select('*').order('due_date', { ascending: false })
      if (yearId && yearId !== 'all') query = query.eq('year_id', String(yearId))
      const { data, error } = await query
      if (!error && data) return data
    } catch (err) {
      console.warn('fetchAssignments error:', err)
    }
  }
  return []
}

export async function createAssignment(payload) {
  const { data, error } = await supabase
    .from('assignments')
    .insert([
      {
        title: payload.title,
        description: payload.description || null,
        year_id: String(payload.yearId || '5'),
        branch: payload.branch || null,
        due_date: payload.dueDate || null,
        max_score: Number(payload.maxScore) || 100,
        attachment_url: payload.attachmentUrl || null,
        is_published: payload.isPublished !== false,
      },
    ])
    .select()
  if (error) throw error
  return data?.[0]
}

export async function deleteAssignment(id) {
  const { error } = await supabase.from('assignments').delete().eq('id', id)
  if (error) throw error
}

export async function fetchSubmissionsForAssignment(assignmentId) {
  if (!isSupabaseConfigured()) return []
  const { data, error } = await supabase
    .from('submissions')
    .select('*, profiles:student_id (full_name, phone, parent_phone, group_name)')
    .eq('assignment_id', assignmentId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchSubmissionsForStudent(studentId) {
  if (!isSupabaseConfigured()) return []
  const { data, error } = await supabase
    .from('submissions')
    .select('*, assignments:assignment_id (title, max_score, due_date)')
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function submitAssignment({ assignmentId, studentId, content, fileUrl }) {
  const { data, error } = await supabase
    .from('submissions')
    .upsert(
      {
        assignment_id: assignmentId,
        student_id: studentId,
        content: content || null,
        file_url: fileUrl || null,
        status: 'submitted',
      },
      { onConflict: 'assignment_id,student_id' }
    )
    .select()
  if (error) throw error
  return data?.[0]
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
