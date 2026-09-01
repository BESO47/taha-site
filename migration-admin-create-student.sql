-- =====================================================================
-- Physics Hub — ADMIN CREATES A STUDENT ACCOUNT
-- ---------------------------------------------------------------------
-- Run AFTER (in this order):
--   1. schema.sql
--   2. homework-grading.sql
--   3. bulk-messaging.sql
--   4. migration-features.sql
--   5. homework-subpoints.sql
--   6. migration-groups-and-admin-editing.sql
--   7. THIS FILE
--
-- WHAT IT ADDS
--   public.admin_create_student(...) — the administrator fills in exactly
--   the fields a student fills in on the signup form (name, e-mail,
--   password, student phone, guardian phone, grade, group, governorate)
--   and the account is created ready to sign in, with no e-mail
--   confirmation round-trip.
--
-- WHY A DATABASE FUNCTION AND NOT supabase.auth.admin.createUser()
--   The GoTrue admin API needs the SERVICE ROLE key. Shipping that key to
--   a browser dashboard would hand every visitor full database powers, so
--   the account is created here instead: SECURITY DEFINER, admin-only,
--   and the password never leaves the database as anything but a bcrypt
--   hash. This mirrors the already-shipped admin_set_student_password().
--
-- HOW THE ROW IS BUILT
--   The function INSERTs into auth.users, and the existing
--   `on_auth_user_created` trigger (handle_new_auth_user) creates the
--   public.profiles row from the same metadata a real signup posts — so
--   there is exactly ONE profile-creation path, and the grade/group rule
--   is enforced identically for admin-created and self-registered
--   students. auth.identities gets the matching e-mail identity so
--   password sign-in and Supabase's own admin UI behave normally.
--
-- Idempotent: safe to run more than once.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- The signup trigger must exist, otherwise the profile would silently not
-- be created and the new account would be able to sign in with no row in
-- public.profiles (a broken, half-created student).
DO $$
BEGIN
  IF to_regprocedure('public.handle_new_auth_user()') IS NULL THEN
    RAISE EXCEPTION 'Run schema.sql (and migration-groups-and-admin-editing.sql) first: public.handle_new_auth_user is missing.';
  END IF;
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run schema.sql first: public.is_admin is missing.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.admin_create_student(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.admin_create_student(
  p_full_name    TEXT,
  p_email        TEXT,
  p_password     TEXT,
  p_phone        TEXT    DEFAULT NULL,
  p_parent_phone TEXT    DEFAULT NULL,
  p_year_id      TEXT    DEFAULT '5',
  p_group_id     UUID    DEFAULT NULL,
  p_governorate  TEXT    DEFAULT NULL,
  p_is_active    BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  new_id             UUID := gen_random_uuid();
  clean_name         TEXT := btrim(regexp_replace(COALESCE(p_full_name, ''), '\s+', ' ', 'g'));
  clean_email        TEXT := lower(btrim(COALESCE(p_email, '')));
  clean_phone        TEXT := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), '');
  clean_parent_phone TEXT := NULLIF(regexp_replace(COALESCE(p_parent_phone, ''), '[^0-9]', '', 'g'), '');
  resolved_year      TEXT;
  hashed_pw          TEXT;
  extra_cols         TEXT := '';
  extra_vals         TEXT := '';
  pair               TEXT[];
  result             JSONB;
BEGIN
  -- ---------------- authorization -----------------------------------
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can create student accounts' USING ERRCODE = '42501';
  END IF;

  -- ---------------- validation (same rules as the signup form) -------
  IF char_length(clean_name) < 2 OR char_length(clean_name) > 120 THEN
    RAISE EXCEPTION 'Name must be between 2 and 120 characters' USING ERRCODE = '22023';
  END IF;

  IF clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Invalid email address format' USING ERRCODE = '22023';
  END IF;

  IF p_password IS NULL OR char_length(p_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters' USING ERRCODE = '22023';
  END IF;

  -- bcrypt (and therefore GoTrue) silently truncates past 72 bytes.
  IF octet_length(p_password) > 72 THEN
    RAISE EXCEPTION 'Password must be at most 72 characters' USING ERRCODE = '22023';
  END IF;

  IF clean_phone IS NULL OR char_length(clean_phone) < 8 THEN
    RAISE EXCEPTION 'A valid student phone number is required' USING ERRCODE = '22023';
  END IF;

  IF clean_parent_phone IS NULL OR char_length(clean_parent_phone) < 8 THEN
    RAISE EXCEPTION 'A valid guardian phone number is required' USING ERRCODE = '22023';
  END IF;

  resolved_year := CASE WHEN COALESCE(p_year_id, '') IN ('5', '6') THEN p_year_id ELSE '5' END;

  -- ---------------- duplicates, reported in plain words --------------
  -- Without these the caller would get a raw unique-violation string
  -- ("duplicate key value violates unique constraint ...") that means
  -- nothing to the teacher typing the form.
  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = clean_email) THEN
    RAISE EXCEPTION 'This email is already registered' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.phone = clean_phone) THEN
    RAISE EXCEPTION 'This student phone number is already registered' USING ERRCODE = '22023';
  END IF;

  -- The grade/group rule itself is enforced by handle_new_auth_user() and
  -- validate_profile_group(); checking here only buys a clearer message
  -- before an auth row is written.
  IF p_group_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.groups g WHERE g.id = p_group_id) THEN
      RAISE EXCEPTION 'The selected group does not exist' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = p_group_id
        AND g.year_id IS NOT NULL
        AND g.year_id IS DISTINCT FROM resolved_year
    ) THEN
      RAISE EXCEPTION 'The selected group does not belong to this grade' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Cost 10 matches GoTrue's bcrypt.GenerateFromPassword default.
  hashed_pw := crypt(p_password, gen_salt('bf', 10));

  -- ---------------- insert the auth user ------------------------------
  -- auth.users differs between Supabase releases (and the test harness
  -- uses a reduced stand-in), so the non-essential columns are added only
  -- when they actually exist. Their values are fixed literals, never
  -- caller input, so the dynamic statement carries no injection risk.
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['instance_id',                '''00000000-0000-0000-0000-000000000000''::uuid'],
    ['aud',                        '''authenticated'''],
    ['role',                       '''authenticated'''],
    ['raw_app_meta_data',          '''{"provider":"email","providers":["email"]}''::jsonb'],
    ['confirmation_token',         ''''''],
    ['recovery_token',             ''''''],
    ['email_change',               ''''''],
    ['email_change_token_new',     ''''''],
    ['email_change_token_current', ''''''],
    ['phone_change',               ''''''],
    ['phone_change_token',         ''''''],
    ['reauthentication_token',     '''''']
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = pair[1]
    ) THEN
      extra_cols := extra_cols || ', ' || quote_ident(pair[1]);
      extra_vals := extra_vals || ', ' || pair[2];
    END IF;
  END LOOP;

  EXECUTE format(
    'INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
                             raw_user_meta_data, created_at, updated_at%s)
     VALUES ($1, $2, $3, now(), $4, now(), now()%s)',
    extra_cols, extra_vals
  )
  USING new_id, clean_email, hashed_pw,
        jsonb_strip_nulls(jsonb_build_object(
          'full_name',    clean_name,
          'phone',        clean_phone,
          'parent_phone', clean_parent_phone,
          'year_id',      resolved_year,
          'governorate',  NULLIF(btrim(COALESCE(p_governorate, '')), ''),
          'group_id',     CASE WHEN p_group_id IS NULL THEN NULL ELSE p_group_id::text END,
          'created_by_admin', to_jsonb(true)
        ));

  -- ---------------- the e-mail identity -------------------------------
  -- GoTrue looks identities up on password sign-in in recent releases; an
  -- account without one can log in on some versions and not on others, so
  -- it is always written when the table is present.
  IF to_regclass('auth.identities') IS NOT NULL THEN
    extra_cols := '';
    extra_vals := '';
    FOREACH pair SLICE 1 IN ARRAY ARRAY[
      ['id',          'gen_random_uuid()'],
      ['provider_id', '$1::text']
    ] LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = pair[1]
      ) THEN
        extra_cols := extra_cols || ', ' || quote_ident(pair[1]);
        extra_vals := extra_vals || ', ' || pair[2];
      END IF;
    END LOOP;

    EXECUTE format(
      'INSERT INTO auth.identities (user_id, identity_data, provider,
                                    last_sign_in_at, created_at, updated_at%s)
       VALUES ($1, $2, ''email'', NULL, now(), now()%s)',
      extra_cols, extra_vals
    )
    USING new_id, jsonb_build_object(
      'sub', new_id::text,
      'email', clean_email,
      'email_verified', true,
      'phone_verified', false
    );
  END IF;

  -- ---------------- the profile ---------------------------------------
  -- Normally written by the on_auth_user_created trigger. The fallback
  -- keeps the function correct on an install where that trigger was
  -- dropped, instead of returning a user with no profile.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = new_id) THEN
    INSERT INTO public.profiles (
      id, full_name, email, phone, parent_phone, year_id, group_id,
      governorate, role, is_active
    ) VALUES (
      new_id, clean_name, clean_email, clean_phone, clean_parent_phone,
      resolved_year, p_group_id,
      left(NULLIF(btrim(COALESCE(p_governorate, '')), ''), 120),
      'student', true
    );
  END IF;

  -- `is_active` is never taken from signup metadata (a student must not be
  -- able to self-activate), so an admin creating a suspended account sets
  -- it here, after the trigger has done its work.
  UPDATE public.profiles
  SET is_active = COALESCE(p_is_active, true)
  WHERE id = new_id;

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
    'is_active', is_active,
    'role', role,
    'created_at', created_at
  ) INTO result
  FROM public.profiles WHERE id = new_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_student(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_student(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- Tell PostgREST about the new function.
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFY (optional — run by hand after the migration)
-- ---------------------------------------------------------------------
--   -- the function is installed and executable by signed-in users only:
--   SELECT proname, proacl
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname = 'admin_create_student';
--
--   -- a student calling it must be rejected:
--   --   ERROR: Only administrators can create student accounts
-- =====================================================================
