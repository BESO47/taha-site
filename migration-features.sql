-- =====================================================================
-- Physics Hub - Feature Migration
-- Multi-group homework, admin student management, attendance edit,
-- student group selection during signup, paginated students
-- ---------------------------------------------------------------------
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--   (Idempotent: safe to run more than once. Run AFTER schema.sql
--    and homework-grading.sql.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ASSIGNMENT_GROUPS — normalized many-to-many homework -> groups
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assignment_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  group_id       UUID NOT NULL REFERENCES public.groups(id)      ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, group_id)
);

CREATE INDEX IF NOT EXISTS assignment_groups_assignment_idx ON public.assignment_groups(assignment_id);
CREATE INDEX IF NOT EXISTS assignment_groups_group_idx      ON public.assignment_groups(group_id);

-- RLS
ALTER TABLE public.assignment_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignment_groups: admin all" ON public.assignment_groups;
CREATE POLICY "assignment_groups: admin all" ON public.assignment_groups
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "assignment_groups: student read" ON public.assignment_groups;
CREATE POLICY "assignment_groups: student read" ON public.assignment_groups
  FOR SELECT TO authenticated
  USING (public.is_active_student());

-- ---------------------------------------------------------------------
-- 2. UPDATED can_access_assignment() — check assignment_groups
--    A student can access an assignment if:
--    - They are admin, OR
--    - Assignment is published AND same year AND active AND
--      (no groups assigned = general, OR student's group_id is in
--       assignment_groups, OR legacy group_name matches)
-- ---------------------------------------------------------------------
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
      AND (
        -- General assignment (no group restriction)
        (a.group_name IS NULL OR a.group_name = '')
        AND NOT EXISTS (SELECT 1 FROM public.assignment_groups ag WHERE ag.assignment_id = a.id)
        OR
        -- Legacy single group_name match
        (a.group_name IS NOT NULL AND a.group_name <> '' AND a.group_name = p.group_name)
        OR
        -- New multi-group via junction table
        EXISTS (
          SELECT 1 FROM public.assignment_groups ag
          WHERE ag.assignment_id = a.id AND ag.group_id = p.group_id
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_access_assignment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_assignment(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. UPDATED homework_catalog view — multi-group support
-- ---------------------------------------------------------------------
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
    AND (
      -- General assignment
      (a.group_name IS NULL OR a.group_name = '')
      AND NOT EXISTS (SELECT 1 FROM public.assignment_groups ag WHERE ag.assignment_id = a.id)
      OR
      -- Legacy group_name
      (a.group_name IS NOT NULL AND a.group_name <> '' AND a.group_name = p.group_name)
      OR
      -- Multi-group junction
      EXISTS (
        SELECT 1 FROM public.assignment_groups ag
        WHERE ag.assignment_id = a.id AND ag.group_id = p.group_id
      )
    )
);

REVOKE ALL ON public.homework_catalog FROM PUBLIC, anon;
GRANT SELECT ON public.homework_catalog TO authenticated;

-- ---------------------------------------------------------------------
-- 4. ADMIN PASSWORD RESET RPC
--    Uses Supabase Management API pattern: calls auth admin endpoint
--    through a SECURITY DEFINER function that invokes the built-in
--    supabase auth user update. Since we can't call Supabase admin API
--    from SQL directly, we use a trusted pattern:
--    The admin calls this RPC, which generates a one-time password
--    reset link via the auth schema (if available) or stores a
--    reset token the frontend uses.
--
--    SAFE APPROACH: Use Supabase's built-in resetPasswordForEmail
--    from an admin-authenticated client context. The RPC below is
--    a helper that validates admin authorization and returns a
--    flag that the frontend uses to trigger the client-side flow.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_initiate_password_reset(target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_email TEXT;
  target_role  TEXT;
BEGIN
  -- Only admins may call this
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can reset passwords' USING ERRCODE = '42501';
  END IF;

  -- Verify the target user exists and is a student
  SELECT email, role INTO target_email, target_role
  FROM public.profiles
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
  END IF;

  IF target_role = 'admin' THEN
    RAISE EXCEPTION 'Cannot reset admin passwords through this interface' USING ERRCODE = '42501';
  END IF;

  -- Return the email so the frontend can trigger Supabase's
  -- resetPasswordForEmail (which sends a secure email link)
  RETURN jsonb_build_object(
    'ok', true,
    'email', target_email,
    'user_id', target_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_initiate_password_reset(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_initiate_password_reset(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. ADMIN SET PASSWORD (direct)
--    Admin sets a new password without email. GoTrue stores bcrypt in
--    auth.users.encrypted_password; we hash with pgcrypto (same scheme).
--
--    BUG: the previous search_path was `public, auth`. On hosted
--    Supabase, pgcrypto lives in the `extensions` schema, so
--    crypt()/gen_salt() raised:
--      function crypt(text, text) does not exist  (SQLSTATE 42883)
--    which the dashboard showed as a failed password change.
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.admin_set_student_password(
  target_user_id UUID,
  new_password   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  target_role TEXT;
  hashed_pw   TEXT;
  updated_n   INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can set passwords' USING ERRCODE = '42501';
  END IF;

  IF new_password IS NULL OR char_length(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters' USING ERRCODE = '22023';
  END IF;

  -- bcrypt (and therefore GoTrue) silently truncates past 72 bytes.
  IF octet_length(new_password) > 72 THEN
    RAISE EXCEPTION 'Password must be at most 72 characters' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO target_role
  FROM public.profiles
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
  END IF;

  IF target_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Cannot set admin passwords through this interface' USING ERRCODE = '42501';
  END IF;

  -- Cost 10 matches GoTrue's bcrypt.GenerateFromPassword default.
  hashed_pw := crypt(new_password, gen_salt('bf', 10));

  UPDATE auth.users
  SET encrypted_password = hashed_pw,
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = target_user_id;

  GET DIAGNOSTICS updated_n = ROW_COUNT;
  IF updated_n = 0 THEN
    RAISE EXCEPTION 'Auth user not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', target_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_student_password(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_student_password(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. ADMIN UPDATE STUDENT PROFILE
--    Securely updates student profile fields including email sync
--    with auth.users. Admin-only.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_student(
  target_user_id   UUID,
  p_full_name      TEXT DEFAULT NULL,
  p_email          TEXT DEFAULT NULL,
  p_phone          TEXT DEFAULT NULL,
  p_parent_phone   TEXT DEFAULT NULL,
  p_year_id        TEXT DEFAULT NULL,
  p_group_id       UUID DEFAULT NULL,
  p_governorate    TEXT DEFAULT NULL,
  p_is_active      BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_email TEXT;
  new_email     TEXT;
  result        JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can update student profiles' USING ERRCODE = '42501';
  END IF;

  -- Validate name length
  IF p_full_name IS NOT NULL AND (char_length(btrim(p_full_name)) < 2 OR char_length(btrim(p_full_name)) > 120) THEN
    RAISE EXCEPTION 'Name must be between 2 and 120 characters' USING ERRCODE = '22023';
  END IF;

  -- Get current email
  SELECT email INTO current_email FROM public.profiles WHERE id = target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
  END IF;

  -- Sync email with auth.users if changed
  IF p_email IS NOT NULL AND btrim(lower(p_email)) <> lower(COALESCE(current_email, '')) THEN
    new_email := btrim(lower(p_email));
    UPDATE auth.users SET email = new_email WHERE id = target_user_id;
  END IF;

  -- Update profile
  UPDATE public.profiles SET
    full_name     = COALESCE(NULLIF(btrim(p_full_name), ''), full_name),
    email         = COALESCE(NULLIF(btrim(p_email), ''), email),
    phone         = COALESCE(NULLIF(btrim(p_phone), ''), phone),
    parent_phone  = COALESCE(NULLIF(btrim(p_parent_phone), ''), parent_phone),
    year_id       = COALESCE(p_year_id, year_id),
    group_id      = p_group_id,
    governorate   = COALESCE(p_governorate, governorate),
    is_active     = COALESCE(p_is_active, is_active)
  WHERE id = target_user_id;

  SELECT jsonb_build_object(
    'id', id,
    'full_name', full_name,
    'email', email,
    'phone', phone,
    'parent_phone', parent_phone,
    'year_id', year_id,
    'group_id', group_id,
    'group_name', group_name,
    'governorate', governorate,
    'is_active', is_active
  ) INTO result FROM public.profiles WHERE id = target_user_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_student(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_student(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. PAGINATED STUDENT LISTING
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_students_paginated(
  p_page       INTEGER DEFAULT 1,
  p_page_size  INTEGER DEFAULT 20,
  p_search     TEXT DEFAULT NULL,
  p_year_id    TEXT DEFAULT NULL,
  p_group_id   UUID DEFAULT NULL,
  p_is_active  BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  total_count  INTEGER;
  offset_val   INTEGER;
  results      JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  p_page := GREATEST(1, p_page);
  p_page_size := LEAST(100, GREATEST(1, p_page_size));
  offset_val := (p_page - 1) * p_page_size;

  -- Count
  SELECT COUNT(*)::INTEGER INTO total_count
  FROM public.profiles p
  WHERE p.role = 'student'
    AND (p_search IS NULL OR p.full_name ILIKE '%' || p_search || '%' OR p.email ILIKE '%' || p_search || '%' OR p.phone ILIKE '%' || p_search || '%')
    AND (p_year_id IS NULL OR p.year_id = p_year_id)
    AND (p_group_id IS NULL OR p.group_id = p_group_id)
    AND (p_is_active IS NULL OR p.is_active = p_is_active);

  -- Fetch page
  SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb ORDER BY p.created_at DESC), '[]'::jsonb)
  INTO results
  FROM (
    SELECT id, full_name, email, phone, parent_phone, year_id, group_id, group_name,
           governorate, is_active, role, created_at
    FROM public.profiles p
    WHERE p.role = 'student'
      AND (p_search IS NULL OR p.full_name ILIKE '%' || p_search || '%' OR p.email ILIKE '%' || p_search || '%' OR p.phone ILIKE '%' || p_search || '%')
      AND (p_year_id IS NULL OR p.year_id = p_year_id)
      AND (p_group_id IS NULL OR p.group_id = p_group_id)
      AND (p_is_active IS NULL OR p.is_active = p_is_active)
    ORDER BY p.created_at DESC
    LIMIT p_page_size OFFSET offset_val
  ) p;

  RETURN jsonb_build_object(
    'data', results,
    'total', total_count,
    'page', p_page,
    'pageSize', p_page_size,
    'totalPages', CEIL(total_count::NUMERIC / p_page_size)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fetch_students_paginated(INTEGER, INTEGER, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_students_paginated(INTEGER, INTEGER, TEXT, TEXT, UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. CANCEL ATTENDANCE (delete record)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_attendance(
  p_student_id   UUID,
  p_session_date DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.attendance
  WHERE student_id = p_student_id AND session_date = p_session_date;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_attendance(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_attendance(UUID, DATE) TO authenticated;

-- ---------------------------------------------------------------------
-- 9. BULK STUDENT OPERATIONS
-- ---------------------------------------------------------------------
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
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.bulk_update_student_status(
  p_student_ids UUID[],
  p_is_active   BOOLEAN
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET is_active = p_is_active
  WHERE id = ANY(p_student_ids) AND role = 'student';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_update_student_status(UUID[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_update_student_status(UUID[], BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------
-- 10. SIGNUP GROUP VALIDATION
--     Update handle_new_auth_user to accept group_id and validate it
--     belongs to the selected year.
-- ---------------------------------------------------------------------
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
  requested_group_id UUID;
  group_year TEXT;
  -- Resolved up front: a bare CASE ... THEN inside an IF condition confuses
  -- the PL/pgSQL parser (it reads the CASE's THEN as the IF's THEN and the
  -- function then fails with "syntax error at end of input").
  resolved_year TEXT;
BEGIN
  resolved_year := CASE WHEN requested_year IN ('5', '6') THEN requested_year ELSE '5' END;

  -- Validate group_id belongs to the selected year (server-side enforcement)
  requested_group_id := NULLIF(metadata ->> 'group_id', '')::UUID;
  IF requested_group_id IS NOT NULL THEN
    SELECT year_id INTO group_year FROM public.groups WHERE id = requested_group_id;
    IF NOT FOUND OR group_year IS DISTINCT FROM resolved_year THEN
      requested_group_id := NULL; -- Reject invalid group silently
    END IF;
  END IF;

  INSERT INTO public.profiles (
    id, full_name, email, phone, parent_phone, year_id, group_id, governorate, role, is_active
  ) VALUES (
    NEW.id,
    left(COALESCE(NULLIF(btrim(metadata ->> 'full_name'), ''), split_part(NEW.email, '@', 1), 'Student'), 120),
    NEW.email,
    clean_phone,
    clean_parent_phone,
    resolved_year,
    requested_group_id,
    left(NULLIF(btrim(metadata ->> 'governorate'), ''), 120),
    'student',
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 11. ASSIGNMENT GROUPS MANAGEMENT RPC
--     Set the groups for an assignment (replaces existing)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_assignment_groups(
  p_assignment_id UUID,
  p_group_ids     UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  -- Remove existing group assignments
  DELETE FROM public.assignment_groups WHERE assignment_id = p_assignment_id;

  -- Insert new ones
  IF p_group_ids IS NOT NULL AND array_length(p_group_ids, 1) > 0 THEN
    INSERT INTO public.assignment_groups (assignment_id, group_id)
    SELECT p_assignment_id, unnest(p_group_ids);
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
  ELSE
    inserted_count := 0;
  END IF;

  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_assignment_groups(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_assignment_groups(UUID, UUID[]) TO authenticated;

-- ---------------------------------------------------------------------
-- 12. FETCH ASSIGNMENT GROUPS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_assignment_groups(p_assignment_id UUID)
RETURNS UUID[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(array_agg(group_id), '{}'::UUID[])
  FROM public.assignment_groups
  WHERE assignment_id = p_assignment_id
$$;

REVOKE ALL ON FUNCTION public.get_assignment_groups(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assignment_groups(UUID) TO authenticated;

-- Done. This migration adds:
--  • assignment_groups junction table + RLS
--  • Updated can_access_assignment() for multi-group
--  • Updated homework_catalog view for multi-group
--  • admin_initiate_password_reset()
--  • admin_set_student_password()
--  • admin_update_student()
--  • fetch_students_paginated()
--  • cancel_attendance()
--  • bulk_update_student_group() + bulk_update_student_status()
--  • Updated handle_new_auth_user() with group validation
--  • set_assignment_groups() + get_assignment_groups()
