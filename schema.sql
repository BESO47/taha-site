-- =============================================
-- Supabase Database Schema for Physics Hub - Eng Taha Elsabagh
-- physics بطريقه مختلفه
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
  ('5', 1, 'ميكانيكا الموائع', 'الوحدة الأولى: خواص الموائع الساكنة', 'درس (1): الضغط والكثافة وقاعدة باسكال', '45 دقيقة', '12.4K', 'https://www.youtube.com/embed/dQw4w9WgXcQ', true, 'ملخص_الضغط_وقاعدة_باسكال.pdf', 'شرح مبسط لمفهوم الضغط في الموائع الساكنة وقاعدة باسكال مع أمثلة وتطبيقات محلولة تدريجياً.'),
  ('6', 1, 'الكهربية والمغناطيسية', 'الوحدة الأولى: التيار الكهربي', 'درس (1): قانون أوم والمقاومة الكهربية', '55 دقيقة', '8.9K', 'https://www.youtube.com/embed/dQw4w9WgXcQ', true, 'ملخص_قانون_أوم.pdf', 'مقدمة في التيار الكهربي وقانون أوم وحساب المقاومة المكافئة للتوصيل على التوالي والتوازي.')
ON CONFLICT DO NOTHING;
