-- =====================================================================
-- Fix admin promotion on an existing Physics Hub Supabase installation
-- ---------------------------------------------------------------------
-- Run this entire file in Supabase Dashboard -> SQL Editor.
-- It is safe to run repeatedly. After it succeeds, replace the example
-- address in the final (commented) SELECT and run that statement.
-- =====================================================================

BEGIN;

-- The profile guard must distinguish a student browser request from a trusted
-- database operation. Supabase's SQL Editor and service-role operations have
-- no end-user JWT, so auth.uid() is NULL. The old guard treated that case as a
-- student update and silently restored the previous role.
CREATE OR REPLACE FUNCTION public.guard_profile_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

-- Provide a repeatable, validated promotion command. A call from SQL Editor
-- is allowed because there is no JWT. An authenticated RPC caller must already
-- be an admin, preventing a student from promoting themselves.
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

REVOKE ALL ON FUNCTION public.promote_to_admin(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_to_admin(TEXT) TO authenticated;

COMMIT;

-- Sign up through the site first. Then replace the email and run this line:
-- SELECT public.promote_to_admin('taha@example.com');

-- Optional verification:
-- SELECT email, role, is_active
-- FROM public.profiles
-- WHERE lower(email) = lower('taha@example.com');
