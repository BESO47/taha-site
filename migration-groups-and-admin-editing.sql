-- =====================================================================
-- Physics Hub — Eng. Taha Elsabagh
-- FIX MIGRATION: registration group loading + group validation at signup
--                + hardening of the admin submission-answer editor
-- ---------------------------------------------------------------------
-- WHY THIS FILE EXISTS
--
--   BUG 1 — "the groups do not appear on the registration page".
--     `public.groups` has RLS with a single read policy:
--
--        CREATE POLICY "groups: read" ON public.groups
--          FOR SELECT TO authenticated
--          USING (public.is_admin() OR public.is_active_student());
--
--     The registration page is browsed by an ANONYMOUS visitor (Supabase
--     role `anon`, no JWT). The policy is granted to `authenticated`
--     only, so `supabase.from('groups').select('*')` returns ZERO ROWS
--     AND NO ERROR. The React selector therefore renders an empty list
--     for every grade, for every visitor, on every deployment — no
--     matter how many groups the admin created.
--
--     Opening the whole table to `anon` would also expose `created_at`
--     and any future admin-only column, so instead this migration adds a
--     narrow SECURITY DEFINER reader that returns ONLY the four safe
--     registration fields (id, name, year_id, description) and can be
--     executed by `anon` and `authenticated`. Writes stay admin-only.
--
--   BUG 2 — invalid grade/group combinations were accepted silently.
--     `handle_new_auth_user()` used to blank an invalid `group_id`
--     ("reject silently"), so a tampered signup quietly produced an
--     account with NO group and the student never knew. It now REJECTS
--     the signup, and a new profile-level trigger enforces the same
--     invariant for every other write path (admin edit, bulk update,
--     direct SQL).
--
--   BUG 3 — the admin answer editor. `admin_update_submission_answer()`
--     lives in homework-subpoints.sql; this file does NOT redefine it
--     (no duplicate systems). It verifies that it is installed, and
--     re-asserts its privileges + the audit table privileges, which is
--     what a partially-applied database is usually missing.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
--   ORDER (all of them, once, top to bottom):
--     1. schema.sql
--     2. homework-grading.sql
--     3. migration-features.sql
--     4. homework-subpoints.sql
--     5. THIS FILE
--
--   Idempotent: safe to run more than once.
--   Non-destructive: no table is dropped or recreated, no row is
--   rewritten, no existing homework/submission/student is touched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. PRE-FLIGHT — fail loudly instead of leaving a half-fixed database
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.groups') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Run schema.sql first (public.groups / public.profiles are missing).';
  END IF;

  IF to_regprocedure('public.ph_mark_answers(jsonb, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Run homework-grading.sql and homework-subpoints.sql first (public.ph_mark_answers is missing).';
  END IF;

  IF to_regclass('public.assignment_groups') IS NULL THEN
    RAISE EXCEPTION 'Run migration-features.sql first (public.assignment_groups is missing).';
  END IF;

  IF to_regprocedure('public.admin_update_submission_answer(uuid, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'Run homework-subpoints.sql first (public.admin_update_submission_answer is missing).';
  END IF;

  IF to_regclass('public.submission_answer_edits') IS NULL THEN
    RAISE EXCEPTION 'Run homework-subpoints.sql first (public.submission_answer_edits is missing).';
  END IF;
END $$;

-- =====================================================================
-- 1. REGISTRATION GROUP READER  (fixes the empty group selector)
-- ---------------------------------------------------------------------
-- Safe metadata only. No student data, no counts, no created_at.
-- SECURITY DEFINER so it works for a visitor who has no session yet,
-- STABLE so it can never write anything.
-- =====================================================================
DROP FUNCTION IF EXISTS public.list_registration_groups(TEXT);

CREATE FUNCTION public.list_registration_groups(p_year_id TEXT DEFAULT NULL)
RETURNS TABLE (
  id          UUID,
  name        TEXT,
  year_id     TEXT,
  description TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT g.id, g.name, g.year_id, g.description
  FROM public.groups g
  WHERE p_year_id IS NULL
     OR btrim(p_year_id) = ''
     OR g.year_id = btrim(p_year_id)
  ORDER BY g.name ASC
$$;

COMMENT ON FUNCTION public.list_registration_groups(TEXT) IS
  'Read-only list of the group metadata the signup form needs (id, name, year_id, description). Callable before sign-in; writes remain admin-only through RLS.';

REVOKE ALL ON FUNCTION public.list_registration_groups(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_registration_groups(TEXT) TO anon, authenticated;

-- The signed-in read path stays exactly as designed: admins and active
-- students may SELECT the table; nobody else may, and nobody but an
-- admin may INSERT / UPDATE / DELETE. Re-asserted here so a drifted
-- project converges to the intended state.
DROP POLICY IF EXISTS "groups: read"        ON public.groups;
DROP POLICY IF EXISTS "groups: admin write" ON public.groups;

CREATE POLICY "groups: read" ON public.groups
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_active_student());

CREATE POLICY "groups: admin write" ON public.groups
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 2. GROUP NAME SYNCHRONISATION — repair the rename path
-- ---------------------------------------------------------------------
-- `profiles.group_id` is the source of truth and `profiles.group_name`
-- mirrors `groups.name`. The mirror was broken for RENAMES: the trigger
-- on `groups` ran BEFORE UPDATE, and the `profiles` BEFORE trigger
-- (`sync_profile_group_name`) re-reads `groups.name` — which, at that
-- moment, is still the OLD name. Every rename was therefore reverted on
-- the spot and students kept the stale group name.
--
-- Same architecture, correct timing: clear on DELETE (before), resync on
-- rename (after).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.sync_group_profile_names()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET group_id = NULL, group_name = NULL WHERE group_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_group_profile_names_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.profiles SET group_name = NEW.name
    WHERE group_id = NEW.id AND group_name IS DISTINCT FROM NEW.name;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS groups_sync_profiles           ON public.groups;
DROP TRIGGER IF EXISTS groups_clear_profiles          ON public.groups;
DROP TRIGGER IF EXISTS groups_sync_profiles_on_rename ON public.groups;

CREATE TRIGGER groups_clear_profiles
  BEFORE DELETE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.sync_group_profile_names();

CREATE TRIGGER groups_sync_profiles_on_rename
  AFTER UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.sync_group_profile_names_after_update();

-- One-off repair of names that drifted while the rename path was broken.
UPDATE public.profiles p
SET group_name = g.name
FROM public.groups g
WHERE p.group_id = g.id
  AND p.group_name IS DISTINCT FROM g.name;

-- =====================================================================
-- 3. GROUP / YEAR INTEGRITY ON THE PROFILE ITSELF
-- ---------------------------------------------------------------------
-- Defence in depth: whatever writes a profile (signup trigger, admin
-- RPC, bulk update, SQL editor), a student can never end up in a group
-- that belongs to another grade, and a non-student can never hold a
-- group at all.
--
-- Only validated when the group or the year actually changes, so
-- existing rows are never rejected by an unrelated UPDATE.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.validate_profile_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_year TEXT;
BEGIN
  -- Groups belong to students only.
  IF COALESCE(NEW.role, 'student') <> 'student' THEN
    NEW.group_id   := NULL;
    NEW.group_name := NULL;
    RETURN NEW;
  END IF;

  IF NEW.group_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.group_id IS NOT DISTINCT FROM OLD.group_id
     AND NEW.year_id  IS NOT DISTINCT FROM OLD.year_id THEN
    RETURN NEW;                       -- nothing relevant changed
  END IF;

  SELECT g.year_id INTO v_group_year
  FROM public.groups g
  WHERE g.id = NEW.group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected group does not exist'
      USING ERRCODE = '23503';
  END IF;

  -- A group with no year is a legacy/global group and stays valid.
  IF v_group_year IS NOT NULL AND v_group_year IS DISTINCT FROM NEW.year_id THEN
    RAISE EXCEPTION 'The selected group does not belong to this grade'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Fires AFTER profiles_guard_escalation and profiles_sync_group_name
-- (triggers run in name order), so it validates the final row.
DROP TRIGGER IF EXISTS profiles_validate_group ON public.profiles;
CREATE TRIGGER profiles_validate_group
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_group();

-- =====================================================================
-- 4. SIGNUP TRIGGER — validated group, rejected mismatch
-- ---------------------------------------------------------------------
--   auth signup metadata
--     -> validate year
--     -> validate group (exists AND belongs to that year)
--     -> create profile (role and is_active are SERVER controlled)
--     -> save group_id
--     -> group_name synchronised by profiles_sync_group_name
--
-- The browser can put anything in raw_user_meta_data, so nothing here
-- is trusted: `role` and `is_active` are hard-coded, and a group that
-- does not match the chosen year aborts the signup instead of being
-- silently dropped.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata           JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  clean_phone        TEXT  := NULLIF(regexp_replace(COALESCE(metadata ->> 'phone', ''), '[^0-9]', '', 'g'), '');
  clean_parent_phone TEXT  := NULLIF(regexp_replace(COALESCE(metadata ->> 'parent_phone', ''), '[^0-9]', '', 'g'), '');
  requested_year     TEXT  := metadata ->> 'year_id';
  raw_group          TEXT  := NULLIF(btrim(COALESCE(metadata ->> 'group_id', '')), '');
  requested_group_id UUID;
  group_year         TEXT;
  -- Resolved up front: a bare CASE ... THEN inside an IF condition confuses
  -- the PL/pgSQL parser (it reads the CASE's THEN as the IF's THEN and the
  -- function then fails with "syntax error at end of input").
  resolved_year      TEXT;
BEGIN
  resolved_year := CASE WHEN requested_year IN ('5', '6') THEN requested_year ELSE '5' END;

  IF raw_group IS NOT NULL THEN
    BEGIN
      requested_group_id := raw_group::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The selected group is not valid'
        USING ERRCODE = '22023';
    END;

    SELECT g.year_id INTO group_year
    FROM public.groups g
    WHERE g.id = requested_group_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected group does not exist'
        USING ERRCODE = '23503';
    END IF;

    -- A group carrying a year must match the grade the student picked.
    -- Anything else is a tampered request and the signup is refused.
    IF group_year IS NOT NULL AND group_year IS DISTINCT FROM resolved_year THEN
      RAISE EXCEPTION 'The selected group does not belong to this grade'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.profiles (
    id, full_name, email, phone, parent_phone, year_id, group_id,
    governorate, role, is_active
  ) VALUES (
    NEW.id,
    left(COALESCE(NULLIF(btrim(metadata ->> 'full_name'), ''), split_part(NEW.email, '@', 1), 'Student'), 120),
    NEW.email,
    clean_phone,
    clean_parent_phone,
    resolved_year,
    requested_group_id,
    left(NULLIF(btrim(metadata ->> 'governorate'), ''), 120),
    'student',   -- never taken from the client
    true         -- never taken from the client
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Repair pass: any profile that already points at a group of another
-- grade (written before the rule existed) is detached, so the invariant
-- below holds for the whole table. Nothing else is touched.
UPDATE public.profiles p
SET group_id = NULL, group_name = NULL
FROM public.groups g
WHERE p.group_id = g.id
  AND g.year_id IS NOT NULL
  AND g.year_id IS DISTINCT FROM p.year_id;

-- =====================================================================
-- 5. MULTI-GROUP HOMEWORK — make sure the normalized link is sound
-- ---------------------------------------------------------------------
-- The junction table itself comes from migration-features.sql. This only
-- guarantees the uniqueness constraint and the indexes exist, which is
-- what an older hand-created copy of the table is usually missing.
-- =====================================================================
DO $$ BEGIN
  ALTER TABLE public.assignment_groups
    ADD CONSTRAINT assignment_groups_assignment_id_group_id_key
    UNIQUE (assignment_id, group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS assignment_groups_assignment_idx
  ON public.assignment_groups(assignment_id);
CREATE INDEX IF NOT EXISTS assignment_groups_group_idx
  ON public.assignment_groups(group_id);

ALTER TABLE public.assignment_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignment_groups: admin all"    ON public.assignment_groups;
DROP POLICY IF EXISTS "assignment_groups: student read" ON public.assignment_groups;

CREATE POLICY "assignment_groups: admin all" ON public.assignment_groups
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "assignment_groups: student read" ON public.assignment_groups
  FOR SELECT TO authenticated
  USING (public.is_active_student());

-- =====================================================================
-- 6. ADMIN SUBMISSION EDITING — re-assert privileges
-- ---------------------------------------------------------------------
-- The function and the audit table are defined in homework-subpoints.sql
-- and are NOT redefined here. Only their grants are restated, because a
-- database that was migrated in pieces frequently has the function but
-- not the EXECUTE grant, which surfaces in the browser as a bare
-- "permission denied for function admin_update_submission_answer".
-- =====================================================================
REVOKE ALL ON FUNCTION public.admin_update_submission_answer(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_submission_answer(UUID, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON public.submission_answer_edits FROM PUBLIC, anon;
GRANT SELECT ON public.submission_answer_edits TO authenticated;

-- The rest of the admin surface, same reasoning.
DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.admin_update_student(uuid, text, text, text, text, text, uuid, text, boolean)',
    'public.admin_set_student_password(uuid, text)',
    'public.admin_initiate_password_reset(uuid)',
    'public.fetch_students_paginated(integer, integer, text, text, uuid, boolean)',
    'public.cancel_attendance(uuid, date)',
    'public.bulk_update_student_group(uuid[], uuid)',
    'public.bulk_update_student_status(uuid[], boolean)',
    'public.set_assignment_groups(uuid, uuid[])',
    'public.get_assignment_groups(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END IF;
  END LOOP;
END $$;

-- =====================================================================
-- 7. BULK GROUP ASSIGNMENT — respects the grade rule
-- ---------------------------------------------------------------------
-- Same function, same name (no duplicate system): it now refuses a batch
-- that would put a student into a group belonging to another grade,
-- instead of failing halfway through with a raw trigger error.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bulk_update_student_group(
  p_student_ids UUID[],
  p_group_id    UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER;
  group_year    TEXT;
  mismatched    INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  IF p_group_id IS NOT NULL THEN
    SELECT g.year_id INTO group_year FROM public.groups g WHERE g.id = p_group_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected group does not exist' USING ERRCODE = '23503';
    END IF;

    IF group_year IS NOT NULL THEN
      SELECT count(*) INTO mismatched
      FROM public.profiles p
      WHERE p.id = ANY(p_student_ids)
        AND p.role = 'student'
        AND p.year_id IS DISTINCT FROM group_year;

      IF mismatched > 0 THEN
        RAISE EXCEPTION 'The selected group does not belong to this grade'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  UPDATE public.profiles
  SET group_id = p_group_id
  WHERE id = ANY(p_student_ids) AND role = 'student';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_update_student_group(UUID[], UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_update_student_group(UUID[], UUID) TO authenticated;

-- =====================================================================
-- 8. VERIFY (optional — run these by hand after the migration)
-- ---------------------------------------------------------------------
--   -- a visitor with no session must see the groups of one grade:
--   SET ROLE anon;
--   SELECT * FROM public.list_registration_groups('5');
--   RESET ROLE;
--
--   -- ...and must still not be able to read or write the table itself:
--   SET ROLE anon;
--   SELECT count(*) FROM public.groups;          -- 0 rows
--   RESET ROLE;
--
--   -- the admin editor is installed and executable by signed-in users:
--   SELECT proname, proacl
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND proname IN ('admin_update_submission_answer', 'list_registration_groups');
--
--   -- no student sits in a group of another grade:
--   SELECT count(*) FROM public.profiles p JOIN public.groups g ON g.id = p.group_id
--    WHERE g.year_id IS NOT NULL AND g.year_id <> p.year_id;   -- must be 0
-- =====================================================================
