import { supabase } from './supabase'

/**
 * Data access layer for the teaching platform.
 * RLS does the real enforcement server-side; these helpers just shape data.
 */

// =====================================================================
// VIDEOS
// =====================================================================
export async function fetchVideos({ yearId = null, publishedOnly = true } = {}) {
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

/** All grades for one quiz, joined with the student's name. */
export async function fetchGradesForQuiz(quizId) {
  const { data, error } = await supabase
    .from('grades')
    .select('*, profiles:student_id (full_name, phone, parent_phone)')
    .eq('quiz_id', quizId)
  if (error) throw error
  return data || []
}

/** Every grade belonging to one student, with the quiz metadata attached. */
export async function fetchGradesForStudent(studentId) {
  const { data, error } = await supabase
    .from('grades')
    .select('*, quizzes:quiz_id (title, max_score, quiz_date, branch)')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/** Insert or overwrite a mark (unique constraint on quiz_id + student_id). */
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
// ASSIGNMENTS + SUBMISSIONS
// =====================================================================
export async function fetchAssignments({ yearId = null } = {}) {
  let query = supabase.from('assignments').select('*').order('due_date', { ascending: false })
  if (yearId && yearId !== 'all') query = query.eq('year_id', String(yearId))
  const { data, error } = await query
  if (error) throw error
  return data || []
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
  const { data, error } = await supabase
    .from('submissions')
    .select('*, profiles:student_id (full_name, phone, parent_phone)')
    .eq('assignment_id', assignmentId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchSubmissionsForStudent(studentId) {
  const { data, error } = await supabase
    .from('submissions')
    .select('*, assignments:assignment_id (title, max_score, due_date)')
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return data || []
}

/** Student submits (or re-submits) their answer. */
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

/** Teacher grades a submission. */
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

/** Upload a submission file into the per-student folder the RLS policy expects. */
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
// ATTENDANCE
// =====================================================================
export async function fetchAttendanceForStudent(studentId) {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('student_id', studentId)
    .order('session_date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAttendanceByDate(sessionDate) {
  const { data, error } = await supabase
    .from('attendance')
    .select('*, profiles:student_id (full_name, phone, parent_phone, year_id)')
    .eq('session_date', sessionDate)
  if (error) throw error
  return data || []
}

/** Mark one student for one day; re-marking the same day overwrites. */
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

/** Save a whole register in one round-trip. */
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
// ANALYTICS
// =====================================================================
export async function fetchStudentAnalytics(studentId = null) {
  let query = supabase.from('student_analytics').select('*')
  if (studentId) query = query.eq('student_id', studentId)
  const { data, error } = await query
  if (error) throw error
  return studentId ? data?.[0] || null : data || []
}

// =====================================================================
// PROFILES
// =====================================================================
export async function fetchStudents() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function updateOwnProfile(id, payload) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name: payload.fullName,
      phone: payload.phone,
      parent_phone: payload.parentPhone,
      governorate: payload.governorate,
      year_id: String(payload.yearId),
    })
    .eq('id', id)
    .select()
  if (error) throw error
  return data?.[0]
}

// =====================================================================
// BULK WHATSAPP MESSAGING REPORT
// =====================================================================
// Preferred path: the `bulk_messaging_report` RPC (bulk-messaging.sql)
// returns one row per student with the LATEST quiz score, homework grade
// and attendance session plus overall attendance — all in a single call.
//
// Fallback path: if that function hasn't been deployed yet, we assemble
// the exact same shape from the existing tables (fetchStudents +
// student_analytics view + per-student latest records).
// =====================================================================

/** Normalise the RPC row or the fallback row into one consistent shape. */
function normalizeReportRow(r) {
  return {
    student_id: r.student_id,
    full_name: r.full_name,
    phone: r.phone,
    parent_phone: r.parent_phone,
    year_id: r.year_id,
    is_active: r.is_active,
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

/**
 * One row per student with the latest quiz / homework / attendance plus
 * overall stats. Optionally filtered to a single grade (year_id).
 */
export async function fetchBulkMessagingReport({ yearId = null } = {}) {
  // 1) Preferred: the RPC (deployed via bulk-messaging.sql)
  try {
    const { data, error } = await supabase.rpc('bulk_messaging_report', {
      target_year: yearId || null,
    })
    if (!error && Array.isArray(data)) {
      return data.map(normalizeReportRow)
    }
    // If the function is missing (error 42883 / PGRST202), fall through.
  } catch (err) {
    console.warn('bulk_messaging_report RPC unavailable, falling back to client assembly', err)
  }

  // 2) Fallback: build the same shape from existing tables.
  const students = (await fetchStudents()).filter(
    (s) => !yearId || s.year_id === yearId
  )
  const analytics = await fetchStudentAnalytics()

  const rows = await Promise.all(
    students.map(async (s) => {
      const [grades, submissions, attendance] = await Promise.all([
        fetchGradesForStudent(s.id),
        fetchSubmissionsForStudent(s.id),
        fetchAttendanceForStudent(s.id),
      ])
      const a = analytics.find((x) => x.student_id === s.id) || {}

      const lastQuiz = grades[0]
      const lastHw = submissions[0]
      const lastAtt = attendance[0]

      return normalizeReportRow({
        student_id: s.id,
        full_name: s.full_name,
        phone: s.phone,
        parent_phone: s.parent_phone,
        year_id: s.year_id,
        is_active: s.is_active,
        total_sessions: a.total_sessions,
        present_count: a.present_count,
        absent_count: a.absent_count,
        late_count: a.late_count,
        attendance_percent: a.attendance_percent,
        last_session_date: lastAtt?.session_date ?? null,
        last_session_attendance: lastAtt?.status ?? null,
        last_quiz_title: lastQuiz?.quizzes?.title ?? null,
        last_quiz_date: lastQuiz?.quizzes?.quiz_date ?? null,
        last_quiz_score: lastQuiz?.score ?? null,
        last_quiz_max: lastQuiz?.quizzes?.max_score ?? null,
        last_homework_title: lastHw?.assignments?.title ?? null,
        last_homework_status: lastHw?.status ?? null,
        last_homework_score: lastHw?.score ?? null,
        last_homework_max: lastHw?.assignments?.max_score ?? null,
      })
    })
  )

  return rows
}
