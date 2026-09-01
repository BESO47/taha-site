-- =====================================================================
-- Physics Hub - Eng Taha Elsabagh  |  physics بطريقه مختلفه
-- Bulk WhatsApp Messaging  —  SQL migration
-- ---------------------------------------------------------------------
-- Adds a single RPC that returns, for every student, the EXACT fields the
-- bulk-messaging template needs (latest quiz score, latest homework grade,
-- last-session attendance status, overall attendance stats). Historical
-- rows are never thrown away; the function only *projects* the latest
-- record per student by ordering each log descending.
--
-- The underlying tables already live in schema.sql:
--   profiles      -> student name / phone / parent_phone / year (grade)
--   quizzes       -> quiz definitions (max_score, quiz_date)
--   grades        -> quiz history   (one score per student per quiz)
--   assignments   -> homework tasks (due_date, max_score)
--   submissions   -> homework history (status + score per student per task)
--   attendance    -> session-by-session log (present/absent/late/excused)
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--   (Idempotent: safe to run more than once.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. bulk_messaging_report(target_year TEXT DEFAULT NULL)
--    One row per student. LEFT JOIN LATERAL pulls ONLY the latest quiz,
--    latest homework and latest attendance session, while the aggregate
--    sub-query computes overall attendance. Order by date/session
--    descending inside each LATERAL so `LIMIT 1` = "latest".
--
--    SECURITY INVOKER (the default) means the caller's RLS still applies:
--      * admins  -> every student's row (admin policies allow full reads)
--      * a student -> only their own row (profiles/grades/attendance/
--        submissions all have "read own" policies), so no one can harvest
--        other students' phone numbers through this endpoint.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_messaging_report(target_year TEXT DEFAULT NULL)
RETURNS TABLE (
  student_id              UUID,
  full_name               TEXT,
  phone                   TEXT,
  parent_phone            TEXT,
  year_id                 TEXT,
  group_name              TEXT,
  is_active               BOOLEAN,

  -- Overall attendance
  total_sessions          BIGINT,
  present_count           BIGINT,
  absent_count            BIGINT,
  late_count              BIGINT,
  attendance_percent      NUMERIC,

  -- Latest attendance session
  last_session_date       DATE,
  last_session_attendance TEXT,

  -- Latest quiz grade
  last_quiz_title         TEXT,
  last_quiz_date          DATE,
  last_quiz_score         NUMERIC,
  last_quiz_max           NUMERIC,

  -- Latest homework submission
  last_homework_title     TEXT,
  last_homework_status    TEXT,
  last_homework_score     NUMERIC,
  last_homework_max       NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    p.id                                                                        AS student_id,
    p.full_name,
    p.phone,
    p.parent_phone,
    p.year_id,
    p.group_name,
    p.is_active,

    -- ---------------- overall attendance ----------------
    a.total_sessions,
    a.present_count,
    a.absent_count,
    a.late_count,
    a.attendance_percent,
    a.last_session_date,
    a.last_session_attendance,

    -- ---------------- latest quiz ----------------
    q.title   AS last_quiz_title,
    q.quiz_date   AS last_quiz_date,
    q.score   AS last_quiz_score,
    q.max_score AS last_quiz_max,

    -- ---------------- latest homework ----------------
    h.title   AS last_homework_title,
    h.status  AS last_homework_status,
    h.score   AS last_homework_score,
    h.max_score AS last_homework_max

  FROM public.profiles p

  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)                                                     AS total_sessions,
      COUNT(*) FILTER (WHERE status IN ('present', 'late'))        AS present_count,
      COUNT(*) FILTER (WHERE status = 'absent')                    AS absent_count,
      COUNT(*) FILTER (WHERE status = 'late')                      AS late_count,
      CASE WHEN COUNT(*) = 0 THEN 0
           ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('present', 'late'))
                      / COUNT(*), 1)
      END                                                          AS attendance_percent,
      (array_agg(session_date ORDER BY session_date DESC, created_at DESC))[1] AS last_session_date,
      (array_agg(status       ORDER BY session_date DESC, created_at DESC))[1] AS last_session_attendance
    FROM public.attendance
    WHERE student_id = p.id
  ) a ON TRUE

  LEFT JOIN LATERAL (
    SELECT qu.title, qu.quiz_date, gr.score, qu.max_score
    FROM public.grades gr
    JOIN public.quizzes qu ON qu.id = gr.quiz_id
    WHERE gr.student_id = p.id
    ORDER BY qu.quiz_date DESC NULLS LAST, gr.created_at DESC
    LIMIT 1
  ) q ON TRUE

  LEFT JOIN LATERAL (
    SELECT asg.title, su.status, su.score, asg.max_score
    FROM public.submissions su
    JOIN public.assignments asg ON asg.id = su.assignment_id
    WHERE su.student_id = p.id
    ORDER BY COALESCE(asg.due_date, su.submitted_at) DESC NULLS LAST, su.submitted_at DESC
    LIMIT 1
  ) h ON TRUE

  WHERE p.role = 'student'
    AND (target_year IS NULL OR p.year_id = target_year)
  ORDER BY p.full_name
$$;

-- Restrict execution to signed-in users (admins get everyone via RLS;
-- students only ever see their own row).
REVOKE ALL ON FUNCTION public.bulk_messaging_report(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_messaging_report(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. (Optional) full history endpoint for a single student.
--    Used by the detail drill-down in the UI: returns ALL quiz grades,
--    homework submissions and attendance sessions, newest first, so the
--    teacher can eyeball the whole log behind each variable.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_progress_log(target_student UUID)
RETURNS TABLE (
  kind        TEXT,
  record_date TIMESTAMPTZ,
  title       TEXT,
  score       NUMERIC,
  max_score   NUMERIC,
  status      TEXT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- Quiz history (newest first). The first branch names the union's result
  -- columns, which is what the trailing ORDER BY is allowed to reference --
  -- an un-aliased union has no column to sort by.
  SELECT 'quiz' AS kind,
         qu.quiz_date::timestamptz AS record_date,
         qu.title AS title,
         gr.score AS score,
         qu.max_score AS max_score,
         NULL::TEXT AS status
  FROM public.grades gr
  JOIN public.quizzes qu ON qu.id = gr.quiz_id
  WHERE gr.student_id = target_student

  UNION ALL

  -- Homework history (newest first)
  SELECT 'homework', COALESCE(asg.due_date, su.submitted_at), asg.title, su.score, asg.max_score, su.status
  FROM public.submissions su
  JOIN public.assignments asg ON asg.id = su.assignment_id
  WHERE su.student_id = target_student

  UNION ALL

  -- Attendance history (newest first)
  SELECT 'attendance', att.session_date::timestamptz, att.session_date::text, NULL, NULL, att.status
  FROM public.attendance att
  WHERE att.student_id = target_student

  ORDER BY record_date DESC NULLS LAST
$$;

REVOKE ALL ON FUNCTION public.student_progress_log(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_progress_log(UUID) TO authenticated;

-- =====================================================================
-- 3. Plain-SQL reference (what the RPC expands to). Handy if you prefer
--    a raw query in the Supabase dashboard instead of the function:
-- =====================================================================
-- SELECT
--   p.full_name,
--   p.phone,
--   (SELECT gr.score FROM grades gr
--      JOIN quizzes qu ON qu.id = gr.quiz_id
--      WHERE gr.student_id = p.id
--      ORDER BY qu.quiz_date DESC NULLS LAST, gr.created_at DESC
--      LIMIT 1)                          AS last_quiz_score,
--   (SELECT su.status FROM submissions su
--      JOIN assignments asg ON asg.id = su.assignment_id
--      WHERE su.student_id = p.id
--      ORDER BY COALESCE(asg.due_date, su.submitted_at) DESC NULLS LAST
--      LIMIT 1)                          AS last_homework_status,
--   (SELECT att.status FROM attendance att
--      WHERE att.student_id = p.id
--      ORDER BY att.session_date DESC
--      LIMIT 1)                          AS last_session_attendance
-- FROM profiles p
-- WHERE p.role = 'student';
