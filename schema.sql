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
CREATE INDEX IF NOT EXISTS profiles_year_group_idx ON public.profiles(year_id, group_name) WHERE role = 'student';

-- Create the application profile atomically with an Auth signup. The client
-- supplies only metadata; role and activation are fixed server-side.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  clean_phone TEXT := NULLIF(regexp_replace(COALESCE(metadata ->> 'phone', ''), '[^0-9]', '', 'g'), '');
  clean_parent_phone TEXT := NULLIF(regexp_replace(COALESCE(metadata ->> 'parent_phone', ''), '[^0-9]', '', 'g'), '');
  requested_year TEXT := metadata ->> 'year_id';
BEGIN
  INSERT INTO public.profiles (
    id, full_name, email, phone, parent_phone, year_id, governorate, role, is_active
  ) VALUES (
    NEW.id,
    left(COALESCE(NULLIF(btrim(metadata ->> 'full_name'), ''), split_part(NEW.email, '@', 1), 'Student'), 120),
    NEW.email,
    clean_phone,
    clean_parent_phone,
    CASE WHEN requested_year IN ('5', '6') THEN requested_year ELSE '5' END,
    left(NULLIF(btrim(metadata ->> 'governorate'), ''), 120),
    'student',
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

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
-- 2b. SAFE COLUMN RETYPE HELPER
--     `ALTER TABLE ... ALTER COLUMN ... TYPE` is the one statement in this
--     script that is NOT idempotent on its own: Postgres refuses it with
--
--       ERROR:  cannot alter type of a column used by a view or rule
--       DETAIL: rule _RETURN on view homework_catalog depends on column "score"
--
--     as soon as a view selects the column -- which homework_catalog and
--     student_analytics both do, so the failure hits on the SECOND run of
--     this script (and on the first run of an install that already had the
--     views). This helper:
--       1. does nothing when the column already has the requested type,
--       2. otherwise records every dependent view (including views stacked
--          on top of them), drops them, retypes the column, then rebuilds
--          them with their original WITH (...) options and privileges.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retype_column(p_table regclass, p_column text, p_type text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current text;
  v_attnum  smallint;
  v_rec     record;
  v_stmt    text;
  v_names   text[] := ARRAY[]::text[];
  v_defs    text[] := ARRAY[]::text[];
  v_opts    text[] := ARRAY[]::text[];
  v_grants  text[] := ARRAY[]::text[];
  v_i       int;
  v_matview text;
BEGIN
  SELECT a.attnum, format_type(a.atttypid, a.atttypmod)
    INTO v_attnum, v_current
    FROM pg_attribute a
   WHERE a.attrelid = p_table AND a.attname = p_column AND NOT a.attisdropped;

  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'retype_column: column %.% does not exist', p_table::text, p_column;
  END IF;

  -- Idempotent: leave everything untouched when the type is already correct.
  IF lower(btrim(v_current)) = lower(btrim(p_type)) THEN
    RETURN;
  END IF;

  -- A materialized view cannot be rebuilt from its definition alone.
  SELECT c.oid::regclass::text INTO v_matview
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class c   ON c.oid = r.ev_class
   WHERE d.classid = 'pg_rewrite'::regclass
     AND d.refclassid = 'pg_class'::regclass
     AND d.refobjid = p_table
     AND d.refobjsubid = v_attnum
     AND r.rulename = '_RETURN'
     AND c.relkind = 'm'
   LIMIT 1;

  IF v_matview IS NOT NULL THEN
    RAISE EXCEPTION 'retype_column: materialized view % reads %.% - drop it manually and refresh it afterwards',
      v_matview, p_table::text, p_column;
  END IF;

  -- Collect the view that selects the column plus every view stacked on top
  -- of it (a view of a view blocks the DROP just as hard), ordered so that a
  -- view always comes after the views it depends on.
  FOR v_rec IN
    WITH RECURSIVE dependents AS (
      SELECT c.oid AS view_oid, 0 AS depth
        FROM pg_depend d
        JOIN pg_rewrite r ON r.oid = d.objid
        JOIN pg_class c   ON c.oid = r.ev_class
       WHERE d.classid = 'pg_rewrite'::regclass
         AND d.refclassid = 'pg_class'::regclass
         AND d.refobjid = p_table
         AND d.refobjsubid = v_attnum
         AND r.rulename = '_RETURN'
         AND c.relkind IN ('v', 'f')
      UNION
      SELECT c.oid, dependents.depth + 1
        FROM dependents
        JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass
                        AND d.refclassid = 'pg_class'::regclass
                        AND d.refobjid = dependents.view_oid
        JOIN pg_rewrite r ON r.oid = d.objid
        JOIN pg_class c   ON c.oid = r.ev_class
       WHERE r.rulename = '_RETURN'
         AND c.relkind IN ('v', 'f')
         AND c.oid <> dependents.view_oid   -- every rule depends on its own relation
    )
    SELECT format('%I.%I', n.nspname, c.relname)                  AS view_name,
           regexp_replace(pg_get_viewdef(c.oid), E';\s*$', '')    AS definition,
           COALESCE(array_to_string(c.reloptions, ', '), '')      AS options,
           COALESCE((SELECT array_to_string(
                              array_agg(format('GRANT %s ON %I.%I TO %s%s',
                                               g.privs, n.nspname, c.relname, g.who,
                                               CASE WHEN g.grantable THEN ' WITH GRANT OPTION' ELSE '' END)),
                              E'\n')
                       FROM (SELECT e.grantee,
                                    string_agg(e.privilege_type, ', ') AS privs,
                                    bool_or(e.is_grantable) AS grantable,
                                    CASE WHEN e.grantee = 0 THEN 'PUBLIC'
                                         ELSE quote_ident(e.grantee::regrole::text) END AS who
                               FROM aclexplode(c.relacl) e
                              GROUP BY e.grantee) g), '')         AS grants
      FROM dependents
      JOIN pg_class c     ON c.oid = dependents.view_oid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     GROUP BY c.oid, n.nspname, c.relname, c.reloptions, c.relacl
     ORDER BY max(dependents.depth)
  LOOP
    v_names  := v_names  || v_rec.view_name;
    v_defs   := v_defs   || v_rec.definition;
    v_opts   := v_opts   || v_rec.options;
    v_grants := v_grants || v_rec.grants;
  END LOOP;

  -- Drop every dependent view, dependents first (the list is bottom-up).
  FOR v_i IN REVERSE coalesce(array_length(v_names, 1), 0) .. 1 LOOP
    EXECUTE format('DROP VIEW %s', v_names[v_i]);
  END LOOP;

  EXECUTE format('ALTER TABLE %s ALTER COLUMN %I TYPE %s', p_table::text, p_column, p_type);

  -- Rebuild them bottom-up with their original options and privileges.
  FOR v_i IN 1 .. coalesce(array_length(v_names, 1), 0) LOOP
    EXECUTE format('CREATE OR REPLACE VIEW %s AS %s', v_names[v_i], v_defs[v_i]);
    IF v_opts[v_i] <> '' THEN
      EXECUTE format('ALTER VIEW %s SET (%s)', v_names[v_i], v_opts[v_i]);
    END IF;
    FOREACH v_stmt IN ARRAY string_to_array(v_grants[v_i], E'\n') LOOP
      IF btrim(v_stmt) <> '' THEN EXECUTE v_stmt; END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'retype_column: %.% % -> %  (% view(s) rebuilt: %)',
    p_table::text, p_column, v_current, p_type,
    coalesce(array_length(v_names, 1), 0),
    coalesce(array_to_string(v_names, ', '), '-');
END;
$$;

-- DDL helper: usable by the owner (the SQL Editor / migration role) only.
REVOKE ALL ON FUNCTION public.retype_column(regclass, text, text) FROM PUBLIC, anon, authenticated;

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

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.sync_group_profile_names()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET group_id = NULL, group_name = NULL WHERE group_id = OLD.id;
    RETURN OLD;
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.profiles SET group_name = NEW.name WHERE group_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS groups_sync_profiles ON public.groups;
CREATE TRIGGER groups_sync_profiles
  BEFORE UPDATE OR DELETE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.sync_group_profile_names();

CREATE OR REPLACE FUNCTION public.sync_profile_group_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    SELECT name INTO NEW.group_name FROM public.groups WHERE id = NEW.group_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.group_id IS NOT NULL THEN
    NEW.group_name := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_group_name ON public.profiles;
CREATE TRIGGER profiles_sync_group_name
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_group_name();

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
CREATE INDEX IF NOT EXISTS grades_student_recent_idx ON public.grades(student_id, created_at DESC);

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
-- Homework explanation video (unlocked for the student once graded)
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS explanation_video_url   TEXT;
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS explanation_video_title TEXT;

CREATE INDEX IF NOT EXISTS assignments_year_id_idx   ON public.assignments(year_id);
CREATE INDEX IF NOT EXISTS assignments_group_name_idx ON public.assignments(group_name);
CREATE INDEX IF NOT EXISTS assignments_feed_idx ON public.assignments(year_id, is_published, group_name, created_at DESC);

DROP TRIGGER IF EXISTS assignments_touch_updated_at ON public.assignments;
CREATE TRIGGER assignments_touch_updated_at
  BEFORE UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  content       TEXT,
  file_url      TEXT, -- private storage object path: <student-uuid>/<file>
  answers       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted', 'graded', 'returned')),
  score         NUMERIC(8,2) CHECK (score IS NULL OR score >= 0),
  feedback      TEXT,
  correct_count    INTEGER,
  incorrect_count  INTEGER,
  unanswered_count INTEGER,
  total_points     NUMERIC(8,2),
  percentage       NUMERIC(5,2) CHECK (percentage IS NULL OR percentage BETWEEN 0 AND 100),
  breakdown        JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_graded      BOOLEAN NOT NULL DEFAULT false,
  graded_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  graded_at     TIMESTAMPTZ,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)    -- one submission per student per task
);

-- Bring pre-grading installations up to the current submission shape.
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS answers          JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS correct_count    INTEGER;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS incorrect_count  INTEGER;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS unanswered_count INTEGER;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS total_points     NUMERIC(8,2);
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS percentage       NUMERIC(5,2);
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS breakdown        JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS auto_graded      BOOLEAN NOT NULL DEFAULT false;

-- Older installs created `score` as NUMERIC(6,2); fractional / weighted marks
-- need NUMERIC(8,2). Goes through retype_column() because homework_catalog and
-- student_analytics select this column and would otherwise block the ALTER
-- with "cannot alter type of a column used by a view or rule".
SELECT public.retype_column('public.submissions', 'score', 'NUMERIC(8,2)');

CREATE INDEX IF NOT EXISTS submissions_student_id_idx    ON public.submissions(student_id);
CREATE INDEX IF NOT EXISTS submissions_assignment_id_idx ON public.submissions(assignment_id);
CREATE INDEX IF NOT EXISTS submissions_student_recent_idx ON public.submissions(student_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS submissions_assignment_recent_idx ON public.submissions(assignment_id, submitted_at DESC);

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
  score           NUMERIC(8,2) NOT NULL DEFAULT 0,
  total_questions INT NOT NULL DEFAULT 0,
  correct_count    INTEGER,
  incorrect_count  INTEGER,
  unanswered_count INTEGER,
  total_points     NUMERIC(8,2),
  percentage       NUMERIC(5,2) CHECK (percentage IS NULL OR percentage BETWEEN 0 AND 100),
  breakdown        JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_graded      BOOLEAN NOT NULL DEFAULT true,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, student_id)        -- one homework submission per student per lesson
);

ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS correct_count    INTEGER;
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS incorrect_count  INTEGER;
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS unanswered_count INTEGER;
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS total_points     NUMERIC(8,2);
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS percentage       NUMERIC(5,2);
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS breakdown        JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS auto_graded      BOOLEAN NOT NULL DEFAULT true;

-- Same story as submissions.score above (safe no-op once it is NUMERIC(8,2)).
SELECT public.retype_column('public.homework_submissions', 'score', 'NUMERIC(8,2)');

CREATE INDEX IF NOT EXISTS homework_submissions_student_id_idx ON public.homework_submissions(student_id);
CREATE INDEX IF NOT EXISTS homework_submissions_lesson_id_idx  ON public.homework_submissions(lesson_id);
CREATE INDEX IF NOT EXISTS homework_submissions_student_recent_idx ON public.homework_submissions(student_id, submitted_at DESC);

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
CREATE INDEX IF NOT EXISTS attendance_student_recent_idx ON public.attendance(student_id, session_date DESC);

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

-- ---------------------------------------------------------------------
-- 8c. VALIDATION, AUTHORIZATION HELPERS, AND SAFE READ MODELS
-- ---------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_name_length_check
    CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_phone_length_check
    CHECK (phone IS NULL OR phone ~ '^[0-9]{10,15}$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.lessons ADD CONSTRAINT lessons_semester_check
    CHECK (semester IN (1, 2)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.lessons ADD CONSTRAINT lessons_video_https_check
    CHECK (video_url ~ '^https://') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.assignments ADD CONSTRAINT assignments_questions_array_check
    CHECK (jsonb_typeof(questions) = 'array' AND pg_column_size(questions) <= 262144) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.submissions ADD CONSTRAINT submissions_answers_object_check
    CHECK (jsonb_typeof(answers) = 'object' AND pg_column_size(answers) <= 65536) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.submissions ADD CONSTRAINT submissions_content_length_check
    CHECK (content IS NULL OR char_length(content) <= 20000) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.groups ADD CONSTRAINT groups_name_length_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 80) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.lessons ADD CONSTRAINT lessons_title_length_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 200) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.assignments ADD CONSTRAINT assignments_title_length_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 200) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.whatsapp_logs ADD CONSTRAINT whatsapp_logs_payload_check
    CHECK (phone ~ '^[0-9]{10,15}$' AND char_length(message_body) BETWEEN 1 AND 4096) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Strip every known answer-key spelling from a JSON question array.
CREATE OR REPLACE FUNCTION public.strip_assessment_answers(payload JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN jsonb_typeof(payload) <> 'array' THEN '[]'::jsonb
    ELSE COALESCE(
      (SELECT jsonb_agg(item - 'answer' - 'correctAnswer' - 'correct' - 'correct_answer' ORDER BY ord)
       FROM jsonb_array_elements(payload) WITH ORDINALITY AS q(item, ord)),
      '[]'::jsonb
    )
  END
$$;

-- This helper is the backend authorization rule for assignment reads/writes.
-- Students cannot switch grade/group in their profile to bypass it because the
-- profile guard below preserves those administrator-managed fields.
CREATE OR REPLACE FUNCTION public.can_access_assignment(target_assignment UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE a.id = target_assignment
      AND a.is_published = true
      AND p.role = 'student'
      AND p.is_active = true
      AND p.year_id = a.year_id
      AND (a.group_name IS NULL OR a.group_name = '' OR a.group_name = p.group_name)
  )
$$;

REVOKE ALL ON FUNCTION public.can_access_assignment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_assignment(UUID) TO authenticated;

-- Read model for public lesson pages. It deliberately runs as the view owner
-- so anon/authenticated callers do not need direct SELECT on `lessons`; every
-- sensitive column is conditionally redacted here.
CREATE OR REPLACE VIEW public.lesson_catalog
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  l.id, l.year_id, l.semester, l.branch, l.unit, l.title, l.duration, l.views,
  CASE
    WHEN public.is_admin() OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'student' AND p.is_active = true AND p.year_id = l.year_id
    ) THEN l.video_url
    ELSE NULL
  END AS video_url,
  l.is_free,
  l.summary_pdf_name,
  CASE
    WHEN public.is_admin() OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'student' AND p.is_active = true AND p.year_id = l.year_id
    ) THEN l.summary_pdf_url
    ELSE NULL
  END AS summary_pdf_url,
  l.description,
  CASE WHEN public.is_admin() THEN l.quiz_json ELSE public.strip_assessment_answers(l.quiz_json) END AS quiz_json,
  CASE WHEN public.is_admin() THEN l.model_answers ELSE '{}'::jsonb END AS model_answers,
  CASE WHEN public.is_admin() THEN l.homework_questions ELSE public.strip_assessment_answers(l.homework_questions) END AS homework_questions,
  l.homework_pdf_name,
  CASE
    WHEN public.is_admin() OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'student' AND p.is_active = true AND p.year_id = l.year_id
    ) THEN l.homework_pdf_url
    ELSE NULL
  END AS homework_pdf_url,
  l.created_at
FROM public.lessons l;

REVOKE ALL ON public.lesson_catalog FROM PUBLIC;
GRANT SELECT ON public.lesson_catalog TO anon, authenticated;

-- Read model for the Homework page. It enforces publication, year and group,
-- strips answer keys, and releases an explanation URL only to an administrator
-- or the student whose own submission has been graded.
CREATE OR REPLACE VIEW public.homework_catalog
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  a.id, a.title, a.description, a.year_id, a.branch, a.due_date, a.max_score,
  a.attachment_url, a.is_published,
  CASE WHEN public.is_admin() THEN a.questions ELSE public.strip_assessment_answers(a.questions) END AS questions,
  a.total_points, a.group_name,
  CASE
    WHEN public.is_admin() OR EXISTS (
      SELECT 1 FROM public.submissions s
      WHERE s.assignment_id = a.id AND s.student_id = auth.uid()
        AND s.status = 'graded' AND s.score IS NOT NULL
    ) THEN a.explanation_video_url
    ELSE NULL
  END AS explanation_video_url,
  (a.explanation_video_url IS NOT NULL) AS has_explanation_video,
  a.explanation_video_title,
  a.created_by, a.created_at, a.updated_at
FROM public.assignments a
WHERE public.is_admin() OR EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.role = 'student'
    AND p.is_active = true
    AND a.is_published = true
    AND p.year_id = a.year_id
    AND (a.group_name IS NULL OR a.group_name = '' OR a.group_name = p.group_name)
);

REVOKE ALL ON public.homework_catalog FROM PUBLIC, anon;
GRANT SELECT ON public.homework_catalog TO authenticated;

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
  WITH CHECK (
    id = auth.uid() AND role = 'student' AND is_active = true
    AND group_id IS NULL AND group_name IS NULL
  );

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
DROP POLICY IF EXISTS "lessons: admin all"   ON public.lessons;

-- Guests/students read lesson_catalog, never this answer-key-bearing table.
CREATE POLICY "lessons: admin all" ON public.lessons
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
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'student' AND p.is_active = true AND p.year_id = videos.year_id
    )
  );

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
DROP POLICY IF EXISTS "assignments: admin all"      ON public.assignments;

-- Students read homework_catalog; direct table access would expose keys and
-- locked explanation URLs.
CREATE POLICY "assignments: admin all" ON public.assignments
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
  WITH CHECK (
    student_id = auth.uid()
    AND public.is_active_student()
    AND public.can_access_assignment(assignment_id)
  );

-- Students may edit only an ungraded submission for an assignment they are
-- still eligible to access. The trigger below whitelists mutable fields.
CREATE POLICY "submissions: update own" ON public.submissions
  FOR UPDATE TO authenticated
  USING (student_id = auth.uid() AND status <> 'graded' AND public.can_access_assignment(assignment_id))
  WITH CHECK (student_id = auth.uid() AND public.can_access_assignment(assignment_id));

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
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_active_student());

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

-- Student writes are intentionally RPC-only (`grade_lesson_homework`). Direct
-- INSERT/UPDATE could otherwise forge score and breakdown columns.
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

-- Message logs contain phone numbers and message bodies; only admins may
-- create or read them.
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

  NEW.role       := OLD.role;
  NEW.is_active  := OLD.is_active;
  NEW.year_id    := OLD.year_id;
  NEW.group_id   := OLD.group_id;
  NEW.group_name := OLD.group_name;
  NEW.email      := OLD.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_escalation ON public.profiles;
CREATE TRIGGER profiles_guard_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_escalation();

-- A student may write answer/content/file fields only. On INSERT and UPDATE,
-- all authoritative grading fields are forced or restored server-side.
CREATE OR REPLACE FUNCTION public.guard_submission_grading()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  autograding BOOLEAN := COALESCE(current_setting('physics_hub.autograde', true), 'off') = 'on';
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() OR autograding THEN
    RETURN NEW;
  END IF;

  IF NEW.file_url IS NOT NULL AND NEW.file_url NOT LIKE auth.uid()::text || '/%' THEN
    RAISE EXCEPTION 'Invalid submission file path' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.student_id       := auth.uid();
    NEW.status           := 'submitted';
    NEW.score            := NULL;
    NEW.feedback         := NULL;
    NEW.graded_by        := NULL;
    NEW.graded_at        := NULL;
    NEW.correct_count    := NULL;
    NEW.incorrect_count  := NULL;
    NEW.unanswered_count := NULL;
    NEW.total_points     := NULL;
    NEW.percentage       := NULL;
    NEW.breakdown        := '[]'::jsonb;
    NEW.auto_graded      := false;
    NEW.submitted_at     := now();
    RETURN NEW;
  END IF;

  NEW.assignment_id    := OLD.assignment_id;
  NEW.student_id       := OLD.student_id;
  NEW.score            := OLD.score;
  NEW.feedback         := OLD.feedback;
  NEW.graded_by        := OLD.graded_by;
  NEW.graded_at        := OLD.graded_at;
  NEW.correct_count    := OLD.correct_count;
  NEW.incorrect_count  := OLD.incorrect_count;
  NEW.unanswered_count := OLD.unanswered_count;
  NEW.total_points     := OLD.total_points;
  NEW.percentage       := OLD.percentage;
  NEW.breakdown        := OLD.breakdown;
  NEW.auto_graded      := OLD.auto_graded;
  NEW.status           := 'submitted';
  NEW.submitted_at     := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS submissions_guard_grading ON public.submissions;
CREATE TRIGGER submissions_guard_grading
  BEFORE INSERT OR UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_submission_grading();

CREATE OR REPLACE FUNCTION public.validate_grade_bounds()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allowed_score NUMERIC;
BEGIN
  IF NEW.score IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'grades' THEN
    SELECT max_score INTO allowed_score FROM public.quizzes WHERE id = NEW.quiz_id;
  ELSE
    SELECT COALESCE(total_points, max_score) INTO allowed_score
    FROM public.assignments WHERE id = NEW.assignment_id;
  END IF;
  IF allowed_score IS NOT NULL AND NEW.score > allowed_score THEN
    RAISE EXCEPTION 'Score % exceeds maximum %', NEW.score, allowed_score USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grades_score_bounds ON public.grades;
CREATE TRIGGER grades_score_bounds
  BEFORE INSERT OR UPDATE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.validate_grade_bounds();

DROP TRIGGER IF EXISTS submissions_score_bounds ON public.submissions;
CREATE TRIGGER submissions_score_bounds
  BEFORE INSERT OR UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.validate_grade_bounds();

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
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'submissions', 'submissions', false, 10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "submissions bucket: read"        ON storage.objects;
DROP POLICY IF EXISTS "submissions bucket: upload own"  ON storage.objects;
DROP POLICY IF EXISTS "submissions bucket: admin all"   ON storage.objects;

CREATE POLICY "submissions bucket: read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Files must be uploaded under the student's uid and use a non-executable
-- allowlisted extension. The bucket itself also enforces MIME and 10 MB size.
CREATE POLICY "submissions bucket: upload own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND lower(storage.extension(name)) IN ('pdf', 'jpg', 'jpeg', 'png', 'webp')
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
  END                                      AS attendance_percent,
  p.group_name
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

REVOKE ALL ON public.student_analytics FROM PUBLIC, anon;
GRANT SELECT ON public.student_analytics TO authenticated;

-- =====================================================================
-- 12. PROMOTE YOURSELF TO ADMIN
--     Sign up through the site first, then run this in the SQL Editor.
--     The function raises a clear error if the auth user or profile is absent.
-- =====================================================================
-- SELECT public.promote_to_admin('taha@example.com');
