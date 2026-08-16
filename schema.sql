-- =============================================
-- Supabase Database Schema for Mostafa Hossam Math Platform
-- =============================================

-- 1. Create Profiles / Students Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  parent_phone TEXT NOT NULL,
  year_id TEXT NOT NULL,
  governorate TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  role TEXT DEFAULT 'student', -- 'student' or 'admin'
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
  video_url TEXT NOT NULL, -- YouTube Embed or Supabase Video URL
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

-- 4. Sample Initial Data Insert (Optional)
INSERT INTO public.lessons (year_id, semester, branch, unit, title, duration, views, video_url, is_free, summary_pdf_name, description)
VALUES 
  ('3', 1, 'الجبر والإحصاء', 'الوحدة الأولى: العلاقات والدوال', 'درس (1): حاصل الضرب الديكارتي للمجموعات', '45 دقيقة', '12.4K', 'https://www.youtube.com/embed/dQw4w9WgXcQ', true, 'ملخص_حاصل_الضرب_الديكارتي.pdf', 'شرح مفصل لمفهوم حاصل الضرب الديكارتي مع أمثلة محلولة تدريجية.'),
  ('7', 1, 'الجبر الخطي', 'الوحدة الأولى: المصفوفات', 'درس (1): مقدمة في البرمجة والمصفوفات', '55 دقيقة', '8.9K', 'https://www.youtube.com/embed/dQw4w9WgXcQ', true, 'ملخص_المصفوفات.pdf', 'مقدمة في المصفوفات والعمليات عليها لمسار الهندسة وعلوم الحاسب.')
ON CONFLICT DO NOTHING;
