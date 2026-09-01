import { createClient } from '@supabase/supabase-js'


let demoDataPromise
const getDemoData = () => {
  if (!demoDataPromise) demoDataPromise = import('../data/dummyData.js')
  return demoDataPromise
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(
  supabaseUrl || 'https://invalid.supabase.co',
  supabaseAnonKey || 'dummy',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
)

export const isSupabaseConfigured = () => {
  if (!supabaseUrl || !supabaseAnonKey) return false
  if (supabaseAnonKey === 'your-anon-public-key' || supabaseAnonKey === 'dummy') return false
  try {
    return new URL(supabaseUrl).protocol === 'https:'
  } catch (_) {
    return false
  }
}

function assertOptionalHttpUrl(value, field) {
  if (!value) return null
  let parsed
  try {
    parsed = new URL(String(value))
  } catch (_) {
    throw new Error(`${field} must be a valid URL`)
  }
  if (parsed.protocol !== 'https:' && !(import.meta.env.DEV && parsed.protocol === 'http:')) {
    throw new Error(`${field} must use HTTPS`)
  }
  return parsed.href
}

function mapLesson(row) {
  if (!row) return null
  return {
    id: row.id,
    yearId: row.year_id,
    semester: row.semester,
    branch: row.branch,
    unit: row.unit,
    title: row.title,
    duration: row.duration,
    views: row.views || '0',
    videoUrl: row.video_url,
    isFree: row.is_free,
    summaryPdfName: row.summary_pdf_name,
    summaryPdfUrl: row.summary_pdf_url,
    description: row.description,
    quiz: row.quiz_json || [],
    modelAnswers: row.model_answers || {},
    homeworkQuestions: row.homework_questions || [],
    homeworkPdfName: row.homework_pdf_name,
    homeworkPdfUrl: row.homework_pdf_url,
  }
}

// Reads use the security-filtered view. Administrators receive full rows;
// students/guests never receive answer keys or unauthorized video URLs.
export async function fetchLessonsFromSupabase() {
  if (!isSupabaseConfigured()) return (await getDemoData()).LESSONS
  const { data, error } = await supabase
    .from('lesson_catalog')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(mapLesson)
}

export async function fetchLessonByIdFromSupabase(lessonId) {
  if (!isSupabaseConfigured()) {
    const { LESSONS } = await getDemoData()
    return LESSONS.find((lesson) => String(lesson.id) === String(lessonId)) || null
  }
  const { data, error } = await supabase
    .from('lesson_catalog')
    .select('*')
    .eq('id', lessonId)
    .maybeSingle()
  if (error) throw error
  return mapLesson(data)
}

function lessonPayload(lessonData) {
  return {
    year_id: String(lessonData.yearId),
    semester: Number(lessonData.semester) || 1,
    branch: String(lessonData.branch || '').trim(),
    unit: String(lessonData.unit || 'الوحدة الأولى').trim(),
    title: String(lessonData.title || '').trim(),
    duration: String(lessonData.duration || '45 دقيقة').trim(),
    video_url: assertOptionalHttpUrl(lessonData.videoUrl, 'Video URL'),
    is_free: lessonData.isFree !== false,
    summary_pdf_name: lessonData.summaryPdfName || null,
    summary_pdf_url: assertOptionalHttpUrl(lessonData.summaryPdfUrl, 'Summary PDF URL'),
    description: String(lessonData.description || '').trim(),
    quiz_json: Array.isArray(lessonData.quiz) ? lessonData.quiz : [],
    model_answers: lessonData.modelAnswers || {},
    homework_questions: Array.isArray(lessonData.homeworkQuestions) ? lessonData.homeworkQuestions : [],
    homework_pdf_name: lessonData.homeworkPdfName || null,
    homework_pdf_url: assertOptionalHttpUrl(lessonData.homeworkPdfUrl, 'Homework PDF URL'),
  }
}

export async function createLessonInSupabase(lessonData) {
  const payload = { ...lessonPayload(lessonData), views: '0' }
  if (!payload.title || !payload.branch || !payload.video_url) throw new Error('Title, branch and video URL are required')

  if (!isSupabaseConfigured()) {
    const { LESSONS } = await getDemoData()
    const newLesson = mapLesson({ id: `lesson-${Date.now()}`, ...payload })
    LESSONS.unshift(newLesson)
    return newLesson
  }

  const { data, error } = await supabase.from('lessons').insert([payload]).select()
  if (error) throw error
  return mapLesson(data?.[0])
}

export async function updateLessonInSupabase(id, lessonData) {
  const payload = lessonPayload(lessonData)
  if (!payload.title || !payload.branch || !payload.video_url) throw new Error('Title, branch and video URL are required')

  if (!isSupabaseConfigured()) {
    const { LESSONS } = await getDemoData()
    const index = LESSONS.findIndex((lesson) => String(lesson.id) === String(id))
    const updated = mapLesson({ id, ...payload })
    if (index !== -1) LESSONS[index] = { ...LESSONS[index], ...updated }
    return index === -1 ? updated : LESSONS[index]
  }

  const { data, error } = await supabase.from('lessons').update(payload).eq('id', id).select()
  if (error) throw error
  return mapLesson(data?.[0])
}

export async function deleteLessonFromSupabase(id) {
  if (!isSupabaseConfigured()) {
    const { LESSONS } = await getDemoData()
    const index = LESSONS.findIndex((lesson) => String(lesson.id) === String(id))
    if (index !== -1) LESSONS.splice(index, 1)
    return
  }
  const { error } = await supabase.from('lessons').delete().eq('id', id)
  if (error) throw error
}

function mapExam(row) {
  if (!row) return null
  return {
    id: row.id,
    yearId: row.year_id,
    title: row.title,
    governorate: row.governorate,
    year: row.year_num,
    semester: row.semester,
    branch: row.branch,
    pdfName: row.pdf_name,
    pdfSize: row.pdf_size || '2.0 MB',
    pdfUrl: row.pdf_url,
    videoSolutionUrl: row.video_solution_url,
  }
}

export async function fetchPastExamsFromSupabase() {
  if (!isSupabaseConfigured()) return (await getDemoData()).PAST_EXAMS
  const { data, error } = await supabase
    .from('past_exams')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(mapExam)
}

function examPayload(examData) {
  return {
    year_id: String(examData.yearId),
    title: String(examData.title || '').trim(),
    governorate: String(examData.governorate || '').trim(),
    year_num: String(examData.yearNum || examData.year || '').trim(),
    semester: Number(examData.semester) || 1,
    branch: String(examData.branch || '').trim(),
    pdf_name: examData.pdfName || 'ورقة_الامتحان.pdf',
    pdf_size: examData.pdfSize || '2.0 MB',
    pdf_url: assertOptionalHttpUrl(examData.pdfUrl, 'Exam PDF URL'),
    video_solution_url: assertOptionalHttpUrl(examData.videoSolutionUrl, 'Solution video URL'),
  }
}

export async function createPastExamInSupabase(examData) {
  const payload = examPayload(examData)
  if (!payload.title || !payload.governorate || !payload.year_num || !payload.branch) {
    throw new Error('Title, governorate, year and branch are required')
  }
  if (!isSupabaseConfigured()) {
    const { PAST_EXAMS } = await getDemoData()
    const newExam = mapExam({ id: `exam-${Date.now()}`, ...payload })
    PAST_EXAMS.unshift(newExam)
    return newExam
  }
  const { data, error } = await supabase.from('past_exams').insert([payload]).select()
  if (error) throw error
  return mapExam(data?.[0])
}

export async function updatePastExamInSupabase(id, examData) {
  const payload = examPayload(examData)
  if (!isSupabaseConfigured()) {
    const { PAST_EXAMS } = await getDemoData()
    const index = PAST_EXAMS.findIndex((exam) => String(exam.id) === String(id))
    const updated = mapExam({ id, ...payload })
    if (index !== -1) PAST_EXAMS[index] = { ...PAST_EXAMS[index], ...updated }
    return index === -1 ? updated : PAST_EXAMS[index]
  }
  const { data, error } = await supabase.from('past_exams').update(payload).eq('id', id).select()
  if (error) throw error
  return mapExam(data?.[0])
}

export async function deletePastExamFromSupabase(id) {
  if (!isSupabaseConfigured()) {
    const { PAST_EXAMS } = await getDemoData()
    const index = PAST_EXAMS.findIndex((exam) => String(exam.id) === String(id))
    if (index !== -1) PAST_EXAMS.splice(index, 1)
    return
  }
  const { error } = await supabase.from('past_exams').delete().eq('id', id)
  if (error) throw error
}

export const SUPABASE_SQL_SCHEMA = `
Run these repository migrations in Supabase SQL Editor, in this order:

1. schema.sql
2. homework-grading.sql
3. bulk-messaging.sql
4. migration-features.sql
5. homework-subpoints.sql
6. migration-groups-and-admin-editing.sql
7. migration-admin-create-student.sql

The scripts create the PostgreSQL tables, constraints, indexes, private storage,
security-filtered content views, Row Level Security policies and server-side RPCs.
See docs/DATABASE.md for the complete model and deployment verification queries.

Create the first administrator only from SQL Editor:
SELECT public.promote_to_admin('YOUR_EMAIL_HERE');
`
