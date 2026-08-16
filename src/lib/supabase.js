import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(
  supabaseUrl || 'https://xyzcompany.supabase.co',
  supabaseAnonKey || 'dummy'
)

export const isSupabaseConfigured = () => {
  return (
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_URL.includes('supabase.co')
  )
}

// ----------------------------------------------------------------------
// LESSONS API
// ----------------------------------------------------------------------
export async function fetchLessonsFromSupabase() {
  if (!isSupabaseConfigured()) return []
  try {
    const { data, error } = await supabase
      .from('lessons')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching lessons:', error)
      return []
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
    }))
  } catch (err) {
    console.error('Unexpected error fetching lessons:', err)
    return []
  }
}

export async function fetchLessonByIdFromSupabase(lessonId) {
  if (!isSupabaseConfigured()) return null
  try {
    const { data, error } = await supabase
      .from('lessons')
      .select('*')
      .eq('id', lessonId)
      .single()

    if (error || !data) return null

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
    }
  } catch (err) {
    return null
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
  const { error } = await supabase.from('lessons').delete().eq('id', id)
  if (error) throw error
}

// ----------------------------------------------------------------------
// PAST EXAMS API
// ----------------------------------------------------------------------
export async function fetchPastExamsFromSupabase() {
  if (!isSupabaseConfigured()) return []
  try {
    const { data, error } = await supabase
      .from('past_exams')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching past exams:', error)
      return []
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
    console.error('Unexpected error fetching past exams:', err)
    return []
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

  const { data, error } = await supabase
    .from('past_exams')
    .update(payload)
    .eq('id', id)
    .select()

  if (error) throw error
  return data?.[0]
}

export async function deletePastExamFromSupabase(id) {
  const { error } = await supabase.from('past_exams').delete().eq('id', id)
  if (error) throw error
}

// ----------------------------------------------------------------------
// PROFILES / STUDENTS API
// ----------------------------------------------------------------------
export async function fetchStudentsFromSupabase() {
  if (!isSupabaseConfigured()) return []
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching students:', error)
      return []
    }

    return (data || []).map((s) => ({
      id: s.id,
      name: s.full_name,
      phone: s.phone,
      parentPhone: s.parent_phone,
      yearId: s.year_id,
      governorate: s.governorate,
      isActive: s.is_active !== false,
      role: s.role || 'student',
      joinedAt: s.created_at ? s.created_at.split('T')[0] : '',
    }))
  } catch (err) {
    console.error('Unexpected error fetching students:', err)
    return []
  }
}

export async function registerStudentInSupabase(studentData) {
  const payload = {
    full_name: studentData.fullName,
    phone: studentData.phone,
    parent_phone: studentData.parentPhone,
    year_id: String(studentData.yearId),
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

// SQL Schema Export
export const SUPABASE_SQL_SCHEMA = `
-- 1. Create Profiles / Students Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  parent_phone TEXT NOT NULL,
  year_id TEXT NOT NULL,
  governorate TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  role TEXT DEFAULT 'student',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Create Lessons Table
CREATE TABLE IF NOT EXISTS public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_id TEXT NOT NULL,
  semester INT NOT NULL DEFAULT 1,
  branch TEXT NOT NULL,
  unit TEXT NOT NULL,
  title TEXT NOT NULL,
  duration TEXT NOT NULL,
  views TEXT DEFAULT '0',
  video_url TEXT NOT NULL,
  is_free BOOLEAN DEFAULT true,
  summary_pdf_name TEXT,
  summary_pdf_url TEXT,
  description TEXT,
  quiz_json JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Create Past Exams Table
CREATE TABLE IF NOT EXISTS public.past_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_id TEXT NOT NULL,
  title TEXT NOT NULL,
  governorate TEXT NOT NULL,
  year_num TEXT NOT NULL,
  semester INT DEFAULT 1,
  branch TEXT NOT NULL,
  pdf_name TEXT NOT NULL,
  pdf_size TEXT DEFAULT '2.0 MB',
  pdf_url TEXT,
  video_solution_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);
`