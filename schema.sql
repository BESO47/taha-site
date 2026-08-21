-- =====================================================================
-- Physics Hub - Eng Taha Elsabagh  |  physics بطريقه مختلفه
-- Supabase schema: tables, indexes, helper functions and RLS policies
-- ---------------------------------------------------------------------
-- Safe to run more than once (idempotent): every statement is guarded
-- with IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--   Then add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PROFILES  (students + admins, 1:1 with auth.users)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT UNIQUE,
  parent_phone  TEXT,
  year_id       TEXT NOT NULL DEFAULT '5',
  group_name    TEXT,
  group_id      UUID,
  governorate   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  role          TEXT NOT NULL DEFAULT 'student',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bring older installs up to date (columns added after first release)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS parent_phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS group_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS group_id UUID;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student';

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check CHECK (role IN ('student', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS profiles_role_idx       ON public.profiles(role);
CREATE INDEX IF NOT EXISTS profiles_year_id_idx    ON public.profiles(year_id);
CREATE INDEX IF NOT EXISTS profiles_group_name_idx ON public.profiles(group_name);

-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS
-- ---------------------------------------------------------------------
-- SECURITY DEFINER is essential here: it lets the function read
-- public.profiles while bypassing RLS, which prevents the infinite
-- recursion you get from a policy on profiles that queries profiles.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_student()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_active = true
  );
$$;

-- Promote an existing profile by email. Calls from the SQL Editor have no
-- JWT (auth.uid() is NULL), while authenticated RPC calls are admin-only.
CREATE OR REPLACE FUNCTION public.promote_to_admin(target_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  target_user_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can promote another user'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(target_email), '') IS NULL THEN
    RAISE EXCEPTION 'An email address is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO target_user_id
  FROM auth.users
  WHERE lower(email) = lower(btrim(target_email));

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth user found for email %', target_email
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.profiles
  SET role = 'admin'
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user exists but has no profile; sign in once before promoting'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN target_user_id;
END;
$$;

-- Functions are executable by PUBLIC unless explicitly restricted. Keep the
-- bootstrap path available to the SQL Editor and expose RPC only to signed-in
-- users; the function itself rejects every non-admin authenticated caller.
REVOKE ALL ON FUNCTION public.promote_to_admin(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_to_admin(TEXT) TO authenticated;

-- Keeps updated_at fresh on tables that have the column
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. LESSONS  (video lessons already used by the site)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lessons (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_id          TEXT NOT NULL,
  semester         INT NOT NULL DEFAULT 1,
  branch           TEXT NOT NULL,
  unit             TEXT NOT NULL,
  title            TEXT NOT NULL,
  duration         TEXT NOT NULL DEFAULT '45 دقيقة',
  views            TEXT DEFAULT '0',
  video_url        TEXT NOT NULL,
  is_free          BOOLEAN DEFAULT true,
  summary_pdf_name TEXT,
  summary_pdf_url  TEXT,
  description      TEXT,
  quiz_json        JSONB DEFAULT '[]'::jsonb,
  model_answers    JSONB DEFAULT '{}'::jsonb,
  homework_questions JSONB DEFAULT '[]'::jsonb,
  homework_pdf_name TEXT,
  homework_pdf_url  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade existing lessons table if already created
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS model_answers JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS homework_questions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS homework_pdf_name TEXT;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS homework_pdf_url TEXT;

CREATE INDEX IF NOT EXISTS lessons_year_id_idx ON public.lessons(year_id);

-- ---------------------------------------------------------------------
-- 3b. GROUPS  (Student grouping & categorization)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  year_id     TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS groups_year_id_idx ON public.groups(year_id);

-- ---------------------------------------------------------------------
-- 4. PAST EXAMS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.past_exams (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_id            TEXT NOT NULL,
  title              TEXT NOT NULL,
  governorate        TEXT NOT NULL,
  year_num           TEXT NOT NULL,
  semester           INT DEFAULT 1,
  branch             TEXT NOT NULL,
  pdf_name           TEXT NOT NULL DEFAULT 'ورقة_الامتحان.pdf',
  pdf_size           TEXT DEFAULT '2.0 MB',
  pdf_url            TEXT,
  video_solution_url TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS past_exams_year_id_idx ON public.past_exams(year_id);

-- ---------------------------------------------------------------------
-- 5. VIDEOS  (YouTube section managed from the dashboard)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.videos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  description  TEXT,
  youtube_url  TEXT NOT NULL,
  year_id      TEXT NOT NULL DEFAULT '5',
  unit         TEXT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  sort_order   INT NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS videos_year_id_idx   ON public.videos(year_id);
CREATE INDEX IF NOT EXISTS videos_published_idx ON public.videos(is_published);

DROP TRIGGER IF EXISTS videos_touch_updated_at ON public.videos;
CREATE TRIGGER videos_touch_updated_at
  BEFORE UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 6. QUIZZES + GRADES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quizzes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  year_id     TEXT NOT NULL DEFAULT '5',
  branch      TEXT,
  semester    INT NOT NULL DEFAULT 1,
  quiz_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  max_score   NUMERIC(6,2) NOT NULL DEFAULT 100 CHECK (max_score > 0),
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quizzes_year_id_idx ON public.quizzes(year_id);

CREATE TABLE IF NOT EXISTS public.grades (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id    UUID NOT NULL REFERENCES public.quizzes(id)  ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  score      NUMERIC(6,2) NOT NULL CHECK (score >= 0),
  notes      TEXT,
  graded_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, student_id)          -- one grade per student per quiz
);

CREATE INDEX IF NOT EXISTS grades_student_id_idx ON public.grades(student_id);
CREATE INDEX IF NOT EXISTS grades_quiz_id_idx    ON public.grades(quiz_id);

DROP TRIGGER IF EXISTS grades_touch_updated_at ON public.grades;
CREATE TRIGGER grades_touch_updated_at
  BEFORE UPDATE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 7. HOMEWORK ENTRIES + SUBMISSIONS
--    (Unified "Homework" module — the old standalone Assignments table was
--     extended to store the merged Assignments + Homework entries:
--     questions JSONB = [{ id, question, options[4], answer, points }],
--     total_points   = sum of question points, group_name = optional group)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,
  description    TEXT,
  year_id        TEXT NOT NULL DEFAULT '5',
  branch         TEXT,
  due_date       TIMESTAMPTZ,
  max_score      NUMERIC(6,2) NOT NULL DEFAULT 100 CHECK (max_score > 0),
  attachment_url TEXT,
  is_published   BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unified Homework module columns (added to existing installs too)
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS questions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS total_points NUMERIC(8,2);
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS group_name TEXT;

CREATE INDEX IF NOT EXISTS assignments_year_id_idx   ON public.assignments(year_id);
CREATE INDEX IF NOT EXISTS assignments_group_name_idx ON public.assignments(group_name);

DROP TRIGGER IF EXISTS assignments_touch_updated_at ON public.assignments;
CREATE TRIGGER assignments_touch_updated_at
  BEFORE UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  content       TEXT,
  file_url      TEXT,
  status        TEXT NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted', 'graded', 'returned')),
  score         NUMERIC(6,2) CHECK (score IS NULL OR score >= 0),
  feedback      TEXT,
  graded_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  graded_at     TIMESTAMPTZ,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)    -- one submission per student per task
);

CREATE INDEX IF NOT EXISTS submissions_student_id_idx    ON public.submissions(student_id);
CREATE INDEX IF NOT EXISTS submissions_assignment_id_idx ON public.submissions(assignment_id);

DROP TRIGGER IF EXISTS submissions_touch_updated_at ON public.submissions;
CREATE TRIGGER submissions_touch_updated_at
  BEFORE UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 7b. HOMEWORK SUBMISSIONS  (Lesson homework submissions & video gating)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.homework_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_id       UUID NOT NULL REFERENCES public.lessons(id)  ON DELETE CASCADE,
  answers         JSONB NOT NULL DEFAULT '{}'::jsonb,
  score           NUMERIC(6,2) NOT NULL DEFAULT 0,
  total_questions INT NOT NULL DEFAULT 0,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, student_id)        -- one homework submission per student per lesson
);

CREATE INDEX IF NOT EXISTS homework_submissions_student_id_idx ON public.homework_submissions(student_id);
CREATE INDEX IF NOT EXISTS homework_submissions_lesson_id_idx  ON public.homework_submissions(lesson_id);

DROP TRIGGER IF EXISTS homework_submissions_touch_updated_at ON public.homework_submissions;
CREATE TRIGGER homework_submissions_touch_updated_at
  BEFORE UPDATE ON public.homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 8. ATTENDANCE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status       TEXT NOT NULL DEFAULT 'present'
               CHECK (status IN ('present', 'absent', 'late', 'excused')),
  year_id      TEXT,
  notes        TEXT,
  recorded_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, session_date)     -- one record per student per day
);

CREATE INDEX IF NOT EXISTS attendance_student_id_idx ON public.attendance(student_id);
CREATE INDEX IF NOT EXISTS attendance_date_idx       ON public.attendance(session_date);

-- ---------------------------------------------------------------------
-- 8b. WHATSAPP LOGS  (Audit log for outgoing bulk WhatsApp messages)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  phone          TEXT NOT NULL,
  recipient_name TEXT,
  recipient_type TEXT NOT NULL DEFAULT 'student'
                 CHECK (recipient_type IN ('student', 'parent')),
  message_body   TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'pending')),
  error_message  TEXT,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_logs_sent_at_idx    ON public.whatsapp_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_logs_student_id_idx ON public.whatsapp_logs(student_id);
CREATE INDEX IF NOT EXISTS whatsapp_logs_status_idx     ON public.whatsapp_logs(status);

-- =====================================================================
-- 9. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
-- Rule of thumb applied below:
--   * students  -> SELECT only their own rows (and public content)
--   * students  -> INSERT/UPDATE only their own assignment submissions
--   * admins    -> full access everywhere via public.is_admin()
-- =====================================================================

ALTER TABLE public.profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.past_exams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_logs        ENABLE ROW LEVEL SECURITY;

-- ------------------------- PROFILES ----------------------------------
DROP POLICY IF EXISTS "profiles: read own"          ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin read all"    ON public.profiles;
DROP POLICY IF EXISTS "profiles: insert own"        ON public.profiles;
DROP POLICY IF EXISTS "profiles: update own"        ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin update all"  ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin delete"      ON public.profiles;

CREATE POLICY "profiles: read own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles: admin read all" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- A student may create only their own profile row at sign-up, and may
-- never hand themselves the admin role.
CREATE POLICY "profiles: insert own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND role = 'student');

-- Students can edit their own contact details. Role / is_active escalation
-- is blocked by the guard_profile_escalation trigger below -- doing it with
-- a subquery here would recurse (a policy on profiles querying profiles).
CREATE POLICY "profiles: update own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles: admin update all" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "profiles: admin delete" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ------------------------- LESSONS -----------------------------------
DROP POLICY IF EXISTS "lessons: read"        ON public.lessons;
DROP POLICY IF EXISTS "lessons: admin write" ON public.lessons;

CREATE POLICY "lessons: read" ON public.lessons
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "lessons: admin write" ON public.lessons
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------ PAST EXAMS ---------------------------------
DROP POLICY IF EXISTS "past_exams: read"        ON public.past_exams;
DROP POLICY IF EXISTS "past_exams: admin write" ON public.past_exams;

CREATE POLICY "past_exams: read" ON public.past_exams
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "past_exams: admin write" ON public.past_exams
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- -------------------------- VIDEOS -----------------------------------
DROP POLICY IF EXISTS "videos: read published" ON public.videos;
DROP POLICY IF EXISTS "videos: admin read all" ON public.videos;
DROP POLICY IF EXISTS "videos: admin write"    ON public.videos;

CREATE POLICY "videos: read published" ON public.videos
  FOR SELECT TO authenticated
  USING (is_published = true AND public.is_active_student());

CREATE POLICY "videos: admin read all" ON public.videos
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "videos: admin write" ON public.videos
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------- QUIZZES -----------------------------------
DROP POLICY IF EXISTS "quizzes: read"        ON public.quizzes;
DROP POLICY IF EXISTS "quizzes: admin write" ON public.quizzes;

CREATE POLICY "quizzes: read" ON public.quizzes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "quizzes: admin write" ON public.quizzes
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- -------------------------- GRADES -----------------------------------
-- The important one: a student sees ONLY their own marks.
DROP POLICY IF EXISTS "grades: read own"     ON public.grades;
DROP POLICY IF EXISTS "grades: admin read"   ON public.grades;
DROP POLICY IF EXISTS "grades: admin write"  ON public.grades;

CREATE POLICY "grades: read own" ON public.grades
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "grades: admin read" ON public.grades
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "grades: admin write" ON public.grades
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------ ASSIGNMENTS --------------------------------
DROP POLICY IF EXISTS "assignments: read published" ON public.assignments;
DROP POLICY IF EXISTS "assignments: admin read"     ON public.assignments;
DROP POLICY IF EXISTS "assignments: admin write"    ON public.assignments;

CREATE POLICY "assignments: read published" ON public.assignments
  FOR SELECT TO authenticated
  USING (is_published = true);

CREATE POLICY "assignments: admin read" ON public.assignments
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "assignments: admin write" ON public.assignments
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------ SUBMISSIONS --------------------------------
DROP POLICY IF EXISTS "submissions: read own"    ON public.submissions;
DROP POLICY IF EXISTS "submissions: insert own"  ON public.submissions;
DROP POLICY IF EXISTS "submissions: update own"  ON public.submissions;
DROP POLICY IF EXISTS "submissions: admin read"  ON public.submissions;
DROP POLICY IF EXISTS "submissions: admin write" ON public.submissions;

CREATE POLICY "submissions: read own" ON public.submissions
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- Active students only, and only as themselves.
CREATE POLICY "submissions: insert own" ON public.submissions
  FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid() AND public.is_active_student());

-- A student may edit their own answer while it is still ungraded. They can
-- never write their own score / feedback: the guard_submission_grading
-- trigger below reverts those columns for non-admins.
CREATE POLICY "submissions: update own" ON public.submissions
  FOR UPDATE TO authenticated
  USING (student_id = auth.uid() AND status <> 'graded')
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "submissions: admin read" ON public.submissions
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "submissions: admin write" ON public.submissions
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------- ATTENDANCE --------------------------------
DROP POLICY IF EXISTS "attendance: read own"    ON public.attendance;
DROP POLICY IF EXISTS "attendance: admin read"  ON public.attendance;
DROP POLICY IF EXISTS "attendance: admin write" ON public.attendance;

CREATE POLICY "attendance: read own" ON public.attendance
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "attendance: admin read" ON public.attendance
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "attendance: admin write" ON public.attendance
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- -------------------------- GROUPS -----------------------------------
DROP POLICY IF EXISTS "groups: read"        ON public.groups;
DROP POLICY IF EXISTS "groups: admin write" ON public.groups;

CREATE POLICY "groups: read" ON public.groups
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "groups: admin write" ON public.groups
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------- HOMEWORK SUBMISSIONS ----------------------------
DROP POLICY IF EXISTS "homework_submissions: read own"       ON public.homework_submissions;
DROP POLICY IF EXISTS "homework_submissions: admin read all" ON public.homework_submissions;
DROP POLICY IF EXISTS "homework_submissions: insert own"     ON public.homework_submissions;
DROP POLICY IF EXISTS "homework_submissions: update own"     ON public.homework_submissions;
DROP POLICY IF EXISTS "homework_submissions: admin all"      ON public.homework_submissions;

CREATE POLICY "homework_submissions: read own" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "homework_submissions: admin read all" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "homework_submissions: insert own" ON public.homework_submissions
  FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid() AND public.is_active_student());

CREATE POLICY "homework_submissions: update own" ON public.homework_submissions
  FOR UPDATE TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "homework_submissions: admin all" ON public.homework_submissions
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ----------------------- WHATSAPP LOGS -------------------------------
DROP POLICY IF EXISTS "whatsapp_logs: admin read"         ON public.whatsapp_logs;
DROP POLICY IF EXISTS "whatsapp_logs: insert authed"      ON public.whatsapp_logs;
DROP POLICY IF EXISTS "whatsapp_logs: admin all"          ON public.whatsapp_logs;

CREATE POLICY "whatsapp_logs: admin read" ON public.whatsapp_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "whatsapp_logs: insert authed" ON public.whatsapp_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "whatsapp_logs: admin all" ON public.whatsapp_logs
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- 9b. PRIVILEGE-ESCALATION GUARD TRIGGERS
--     RLS WITH CHECK clauses cannot safely read the row's own table
--     (that recurses), so these triggers hold the invariants instead.
-- =====================================================================

-- A student may not promote themselves to admin, nor lift their own
-- suspension. Admin updates pass through untouched.
CREATE OR REPLACE FUNCTION public.guard_profile_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- SQL Editor and trusted server-side/service-role operations do not carry
  -- an end-user JWT, so auth.uid() is NULL. They must be allowed through for
  -- initial admin bootstrapping; browser requests are still constrained by
  -- RLS and always have a non-NULL uid here.
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  NEW.role      := OLD.role;
  NEW.is_active := OLD.is_active;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_escalation ON public.profiles;
CREATE TRIGGER profiles_guard_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_escalation();

-- A student may rewrite their answer, but score / feedback / status
-- stay exactly as the teacher left them.
CREATE OR REPLACE FUNCTION public.guard_submission_grading()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins grade freely; the server-side auto-marker
  -- (grade_assignment_submission in homework-grading.sql) sets the
  -- physics_hub.autograde flag while it writes the computed score.
  IF public.is_admin() OR COALESCE(current_setting('physics_hub.autograde', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  NEW.score     := OLD.score;
  NEW.feedback  := OLD.feedback;
  NEW.graded_by := OLD.graded_by;
  NEW.graded_at := OLD.graded_at;

  -- students may only ever put a row back into 'submitted'
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'submitted' THEN
    NEW.status := OLD.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS submissions_guard_grading ON public.submissions;
CREATE TRIGGER submissions_guard_grading
  BEFORE UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_submission_grading();

-- Stamp the acting teacher onto grading actions automatically.
CREATE OR REPLACE FUNCTION public.stamp_grader()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'grades' THEN
    NEW.graded_by := COALESCE(NEW.graded_by, auth.uid());
  ELSIF NEW.status = 'graded' THEN
    NEW.graded_by := COALESCE(NEW.graded_by, auth.uid());
    NEW.graded_at := COALESCE(NEW.graded_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grades_stamp_grader ON public.grades;
CREATE TRIGGER grades_stamp_grader
  BEFORE INSERT OR UPDATE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.stamp_grader();

-- Runs after submissions_guard_grading (triggers fire in name order),
-- so only an admin's write reaches it with score/status intact.
DROP TRIGGER IF EXISTS submissions_stamp_grader ON public.submissions;
CREATE TRIGGER submissions_stamp_grader
  BEFORE INSERT OR UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.stamp_grader();

-- =====================================================================
-- 10. STORAGE BUCKET for assignment file uploads
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('submissions', 'submissions', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "submissions bucket: read"        ON storage.objects;
DROP POLICY IF EXISTS "submissions bucket: upload own"  ON storage.objects;
DROP POLICY IF EXISTS "submissions bucket: admin all"   ON storage.objects;

CREATE POLICY "submissions bucket: read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'submissions');

-- Files must be uploaded under a folder named after the student's uid,
-- e.g.  submissions/<auth.uid()>/<assignment-id>-file.pdf
CREATE POLICY "submissions bucket: upload own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "submissions bucket: admin all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'submissions' AND public.is_admin())
  WITH CHECK (bucket_id = 'submissions' AND public.is_admin());

-- =====================================================================
-- 11. ANALYTICS VIEW  (per-student summary used by profile + dashboard)
--     security_invoker = the caller's RLS still applies, so a student
--     querying this view sees only their own row.
-- =====================================================================
CREATE OR REPLACE VIEW public.student_analytics
WITH (security_invoker = true) AS
SELECT
  p.id                                     AS student_id,
  p.full_name,
  p.phone,
  p.parent_phone,
  p.year_id,
  p.is_active,
  COALESCE(g.quiz_count, 0)                AS quiz_count,
  ROUND(COALESCE(g.avg_percent, 0), 1)     AS avg_quiz_percent,
  COALESCE(s.submission_count, 0)          AS submission_count,
  COALESCE(s.graded_count, 0)              AS graded_count,
  ROUND(COALESCE(s.avg_assignment_percent, 0), 1) AS avg_assignment_percent,
  COALESCE(a.total_sessions, 0)            AS total_sessions,
  COALESCE(a.present_count, 0)             AS present_count,
  COALESCE(a.absent_count, 0)              AS absent_count,
  COALESCE(a.late_count, 0)                AS late_count,
  CASE WHEN COALESCE(a.total_sessions, 0) = 0 THEN 0
       ELSE ROUND(100.0 * a.present_count / a.total_sessions, 1)
  END                                      AS attendance_percent
FROM public.profiles p
LEFT JOIN (
  SELECT gr.student_id,
         COUNT(*) AS quiz_count,
         AVG(100.0 * gr.score / NULLIF(q.max_score, 0)) AS avg_percent
  FROM public.grades gr
  JOIN public.quizzes q ON q.id = gr.quiz_id
  GROUP BY gr.student_id
) g ON g.student_id = p.id
LEFT JOIN (
  SELECT su.student_id,
         COUNT(*) AS submission_count,
         COUNT(*) FILTER (WHERE su.status = 'graded') AS graded_count,
         AVG(100.0 * su.score / NULLIF(asg.max_score, 0))
           FILTER (WHERE su.score IS NOT NULL) AS avg_assignment_percent
  FROM public.submissions su
  JOIN public.assignments asg ON asg.id = su.assignment_id
  GROUP BY su.student_id
) s ON s.student_id = p.id
LEFT JOIN (
  SELECT att.student_id,
         COUNT(*) AS total_sessions,
         COUNT(*) FILTER (WHERE att.status IN ('present', 'late')) AS present_count,
         COUNT(*) FILTER (WHERE att.status = 'absent') AS absent_count,
         COUNT(*) FILTER (WHERE att.status = 'late')   AS late_count
  FROM public.attendance att
  GROUP BY att.student_id
) a ON a.student_id = p.id
WHERE p.role = 'student';

-- =====================================================================
-- 12. PROMOTE YOURSELF TO ADMIN
--     Sign up through the site first, then run this in the SQL Editor.
--     The function raises a clear error if the auth user or profile is absent.
-- =====================================================================
-- SELECT public.promote_to_admin('taha@example.com');
