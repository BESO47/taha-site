import { createClient } from '@supabase/supabase-js'
import { LESSONS, PAST_EXAMS, SAMPLE_STUDENTS, DEFAULT_GROUPS } from '../data/dummyData'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(
  supabaseUrl || 'https://xyzcompany.supabase.co',
  supabaseAnonKey || 'dummy'
)

export const isSupabaseConfigured = () => {
  return (
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_URL.includes('supabase.co') &&
    import.meta.env.VITE_SUPABASE_ANON_KEY &&
    import.meta.env.VITE_SUPABASE_ANON_KEY !== 'your-anon-public-key' &&
    import.meta.env.VITE_SUPABASE_ANON_KEY !== 'dummy'
  )
}

// ----------------------------------------------------------------------
// LESSONS API
// ----------------------------------------------------------------------
export async function fetchLessonsFromSupabase() {
  if (!isSupabaseConfigured()) return LESSONS
  try {
    const { data, error } = await supabase
      .from('lessons')
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !data || data.length === 0) {
      console.warn('Supabase lessons empty or error, using default lessons:', error)
      return LESSONS
    }

    return (data || []).map((l) => ({
      id: l.id,
      yearId: l.year_id,
      semester: l.semester,
      branch: l.branch,
      unit: l.unit,
      title: l.title,
      duration: l.duration,
      views: l.views || '0',
      videoUrl: l.video_url,
      isFree: l.is_free,
      summaryPdfName: l.summary_pdf_name,
      summaryPdfUrl: l.summary_pdf_url,
      description: l.description,
      quiz: l.quiz_json || [],
      modelAnswers: l.model_answers || {},
      homeworkQuestions: l.homework_questions || [],
      homeworkPdfName: l.homework_pdf_name,
      homeworkPdfUrl: l.homework_pdf_url,
    }))
  } catch (err) {
    console.error('Unexpected error fetching lessons:', err)
    return LESSONS
  }
}

export async function fetchLessonByIdFromSupabase(lessonId) {
  if (!isSupabaseConfigured()) {
    return LESSONS.find((l) => String(l.id) === String(lessonId)) || null
  }
  try {
    const { data, error } = await supabase
      .from('lessons')
      .select('*')
      .eq('id', lessonId)
      .single()

    if (error || !data) {
      return LESSONS.find((l) => String(l.id) === String(lessonId)) || null
    }

    return {
      id: data.id,
      yearId: data.year_id,
      semester: data.semester,
      branch: data.branch,
      unit: data.unit,
      title: data.title,
      duration: data.duration,
      views: data.views || '0',
      videoUrl: data.video_url,
      isFree: data.is_free,
      summaryPdfName: data.summary_pdf_name,
      summaryPdfUrl: data.summary_pdf_url,
      description: data.description,
      quiz: data.quiz_json || [],
      modelAnswers: data.model_answers || {},
      homeworkQuestions: data.homework_questions || [],
      homeworkPdfName: data.homework_pdf_name,
      homeworkPdfUrl: data.homework_pdf_url,
    }
  } catch (err) {
    return LESSONS.find((l) => String(l.id) === String(lessonId)) || null
  }
}

export async function createLessonInSupabase(lessonData) {
  const payload = {
    year_id: String(lessonData.yearId),
    semester: Number(lessonData.semester) || 1,
    branch: lessonData.branch,
    unit: lessonData.unit || 'الوحدة الأولى',
    title: lessonData.title,
    duration: lessonData.duration || '45 دقيقة',
    views: '0',
    video_url: lessonData.videoUrl,
    is_free: lessonData.isFree !== false,
    summary_pdf_name: lessonData.summaryPdfName || null,
    summary_pdf_url: lessonData.summaryPdfUrl || null,
    description: lessonData.description || '',
    quiz_json: lessonData.quiz || [],
    model_answers: lessonData.modelAnswers || {},
    homework_questions: lessonData.homeworkQuestions || [],
    homework_pdf_name: lessonData.homeworkPdfName || null,
    homework_pdf_url: lessonData.homeworkPdfUrl || null,
  }

  if (!isSupabaseConfigured()) {
    const newLesson = { id: `lesson-${Date.now()}`, ...payload }
    LESSONS.unshift(newLesson)
    return newLesson
  }

  const { data, error } = await supabase.from('lessons').insert([payload]).select()
  if (error) throw error
  return data?.[0]
}

export async function updateLessonInSupabase(id, lessonData) {
  const payload = {
    year_id: String(lessonData.yearId),
    semester: Number(lessonData.semester) || 1,
    branch: lessonData.branch,
    unit: lessonData.unit || 'الوحدة الأولى',
    title: lessonData.title,
    duration: lessonData.duration || '45 دقيقة',
    video_url: lessonData.videoUrl,
    is_free: lessonData.isFree !== false,
    summary_pdf_name: lessonData.summaryPdfName || null,
    summary_pdf_url: lessonData.summaryPdfUrl || null,
    description: lessonData.description || '',
    quiz_json: lessonData.quiz || [],
    model_answers: lessonData.modelAnswers || {},
    homework_questions: lessonData.homeworkQuestions || [],
    homework_pdf_name: lessonData.homeworkPdfName || null,
    homework_pdf_url: lessonData.homeworkPdfUrl || null,
  }

  if (!isSupabaseConfigured()) {
    const idx = LESSONS.findIndex((l) => String(l.id) === String(id))
    if (idx !== -1) {
      LESSONS[idx] = { ...LESSONS[idx], ...payload }
      return LESSONS[idx]
    }
    return { id, ...payload }
  }

  const { data, error } = await supabase
    .from('lessons')
    .update(payload)
    .eq('id', id)
    .select()

  if (error) throw error
  return data?.[0]
}

export async function deleteLessonFromSupabase(id) {
  if (!isSupabaseConfigured()) {
    const idx = LESSONS.findIndex((l) => String(l.id) === String(id))
    if (idx !== -1) LESSONS.splice(idx, 1)
    return
  }
  const { error } = await supabase.from('lessons').delete().eq('id', id)
  if (error) throw error
}

// ----------------------------------------------------------------------
// PAST EXAMS API
// ----------------------------------------------------------------------
export async function fetchPastExamsFromSupabase() {
  if (!isSupabaseConfigured()) return PAST_EXAMS
  try {
    const { data, error } = await supabase
      .from('past_exams')
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !data || data.length === 0) {
      return PAST_EXAMS
    }

    return (data || []).map((e) => ({
      id: e.id,
      yearId: e.year_id,
      title: e.title,
      governorate: e.governorate,
      year: e.year_num,
      semester: e.semester,
      branch: e.branch,
      pdfName: e.pdf_name,
      pdfSize: e.pdf_size || '2.0 MB',
      pdfUrl: e.pdf_url,
      videoSolutionUrl: e.video_solution_url,
    }))
  } catch (err) {
    return PAST_EXAMS
  }
}

export async function createPastExamInSupabase(examData) {
  const payload = {
    year_id: String(examData.yearId),
    title: examData.title,
    governorate: examData.governorate,
    year_num: String(examData.yearNum || examData.year),
    semester: Number(examData.semester) || 1,
    branch: examData.branch,
    pdf_name: examData.pdfName || 'ورقة_الامتحان.pdf',
    pdf_size: examData.pdfSize || '2.0 MB',
    pdf_url: examData.pdfUrl || null,
    video_solution_url: examData.videoSolutionUrl || null,
  }

  if (!isSupabaseConfigured()) {
    const newExam = { id: `exam-${Date.now()}`, ...payload }
    PAST_EXAMS.unshift(newExam)
    return newExam
  }

  const { data, error } = await supabase.from('past_exams').insert([payload]).select()
  if (error) throw error
  return data?.[0]
}

export async function updatePastExamInSupabase(id, examData) {
  const payload = {
    year_id: String(examData.yearId),
    title: examData.title,
    governorate: examData.governorate,
    year_num: String(examData.yearNum || examData.year),
    semester: Number(examData.semester) || 1,
    branch: examData.branch,
    pdf_name: examData.pdfName || 'ورقة_الامتحان.pdf',
    pdf_size: examData.pdfSize || '2.0 MB',
    pdf_url: examData.pdfUrl || null,
    video_solution_url: examData.videoSolutionUrl || null,
  }

  if (!isSupabaseConfigured()) {
    const idx = PAST_EXAMS.findIndex((e) => String(e.id) === String(id))
    if (idx !== -1) {
      PAST_EXAMS[idx] = { ...PAST_EXAMS[idx], ...payload }
      return PAST_EXAMS[idx]
    }
    return { id, ...payload }
  }

  const { data, error } = await supabase
    .from('past_exams')
    .update(payload)
    .eq('id', id)
    .select()

  if (error) throw error
  return data?.[0]
}

export async function deletePastExamFromSupabase(id) {
  if (!isSupabaseConfigured()) {
    const idx = PAST_EXAMS.findIndex((e) => String(e.id) === String(id))
    if (idx !== -1) PAST_EXAMS.splice(idx, 1)
    return
  }
  const { error } = await supabase.from('past_exams').delete().eq('id', id)
  if (error) throw error
}

// ----------------------------------------------------------------------
// PROFILES / STUDENTS API
// ----------------------------------------------------------------------
export async function fetchStudentsFromSupabase() {
  if (!isSupabaseConfigured()) return SAMPLE_STUDENTS
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !data || data.length === 0) {
      return SAMPLE_STUDENTS
    }

    return (data || []).map((s) => ({
      id: s.id,
      name: s.full_name,
      phone: s.phone,
      parentPhone: s.parent_phone,
      yearId: s.year_id,
      groupName: s.group_name || '',
      groupId: s.group_id || null,
      governorate: s.governorate,
      isActive: s.is_active !== false,
      role: s.role || 'student',
      joinedAt: s.created_at ? s.created_at.split('T')[0] : '',
    }))
  } catch (err) {
    return SAMPLE_STUDENTS
  }
}

export async function registerStudentInSupabase(studentData) {
  const payload = {
    full_name: studentData.fullName,
    phone: studentData.phone,
    parent_phone: studentData.parentPhone,
    year_id: String(studentData.yearId),
    group_name: studentData.groupName || null,
    governorate: studentData.governorate,
    is_active: true,
    role: 'student',
  }

  const { data, error } = await supabase.from('profiles').insert([payload]).select()
  if (error) throw error
  return data?.[0]
}

export async function updateStudentInSupabase(id, studentData) {
  const payload = {
    full_name: studentData.name,
    phone: studentData.phone,
    parent_phone: studentData.parentPhone,
    year_id: String(studentData.yearId),
    group_name: studentData.groupName || null,
    governorate: studentData.governorate,
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', id)
    .select()

  if (error) throw error
  return data?.[0]
}

export async function toggleStudentActiveInSupabase(id, currentStatus) {
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: !currentStatus })
    .eq('id', id)

  if (error) throw error
}

export const SUPABASE_SQL_SCHEMA = `
-- Run the COMPLETE script from schema.sql in your repo.
-- It creates every table below plus RLS policies, guard triggers,
-- storage buckets and the student_analytics view.

-- 1. profiles              : students + admins (role, group_name, group_id, is_active)
-- 2. groups                : group names & centers (id, name, year_id, description)
-- 3. lessons               : lessons + model_answers (jsonb) + homework_questions (jsonb)
-- 4. homework_submissions  : student homework answers, score, total_questions, submitted_at
-- 5. past_exams            : governorate exam papers
-- 6. videos                : YouTube library managed from dashboard
-- 7. quizzes + grades      : quiz definitions & student marks
-- 8. assignments           : general homework tasks & submissions
-- 9. attendance            : present / absent / late / excused log
-- 10. whatsapp_logs        : bulk WhatsApp delivery logs & statuses

-- Bulk WhatsApp messaging RPC:
-- Run bulk-messaging.sql from repo in SQL Editor.

-- Promote yourself to teacher:
UPDATE public.profiles SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL_HERE');
`
