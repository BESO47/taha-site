-- =====================================================================
-- Physics Hub - Eng Taha Elsabagh  |  physics بطريقه مختلفه
-- Homework MARKING / GRADING  —  answer-key based scoring
-- ---------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES
--   1. Adds marking-analytics columns to `submissions` and
--      `homework_submissions` (answers, correct/incorrect counts,
--      percentage, per-question breakdown).
--   2. Adds SQL helpers that resolve an answer into a canonical option
--      letter (A/B/C/D) exactly like `src/lib/grading.js` does.
--   3. Adds `grade_assignment_submission()` — the authoritative marker.
--      A student calls it to hand in their answers; the function compares
--      every answer with the teacher's key server-side, computes the
--      score / percentage and stores the result. Students can therefore
--      never post their own score, and the key never leaves the server.
--   4. Adds `regrade_assignment()` / `regrade_lesson_homework()` so the
--      teacher can re-mark all stored papers after fixing the key.
--   5. Teaches the anti-cheat trigger to allow the auto-marker.
--   6. Adds `assignments.explanation_video_url/_title` — the homework
--      explanation video that unlocks once a submission is graded.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--   (Idempotent: safe to run more than once. Run AFTER schema.sql.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. COLUMNS
-- ---------------------------------------------------------------------
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS answers          JSONB   DEFAULT '{}'::jsonb;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS correct_count    INTEGER;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS incorrect_count  INTEGER;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS unanswered_count INTEGER;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS total_points     NUMERIC(8,2);
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS percentage       NUMERIC(5,2);
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS breakdown        JSONB   DEFAULT '[]'::jsonb;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS auto_graded      BOOLEAN NOT NULL DEFAULT false;

-- Homework explanation video: shown on the Homework page and unlocked for a
-- student only once their submission is graded (see src/pages/HomeworkPage.jsx).
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS explanation_video_url   TEXT;
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS explanation_video_title TEXT;

ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS correct_count    INTEGER;
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS incorrect_count  INTEGER;
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS unanswered_count INTEGER;
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS total_points     NUMERIC(8,2);
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS percentage       NUMERIC(5,2);
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS breakdown        JSONB   DEFAULT '[]'::jsonb;
ALTER TABLE public.homework_submissions ADD COLUMN IF NOT EXISTS auto_graded      BOOLEAN NOT NULL DEFAULT true;

-- The score column must accept fractional / weighted points.
ALTER TABLE public.homework_submissions ALTER COLUMN score TYPE NUMERIC(8,2);

-- ---------------------------------------------------------------------
-- 2. TEXT / ANSWER NORMALIZATION HELPERS
--    Mirror of normalizeText() + toOptionLetter() in src/lib/grading.js
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ph_norm_text(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        lower(
          translate(
            -- 1) drop harakat + tatweel   2) unify digits and alef/ya/ta-marbuta
            translate(COALESCE(raw, ''), 'ًٌٍَُِّْـ', ''),
            '٠١٢٣٤٥٦٧٨٩إأآاىة',
            '0123456789اااايه'
          )
        ),
        -- 3) any punctuation / symbol becomes a single space
        '[^[:alnum:]]+', ' ', 'g'
      )
    ),
  '')
$$;

-- Strip a leading "A) " / "1- " / "ب. " option prefix.
CREATE OR REPLACE FUNCTION public.ph_strip_option_prefix(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(COALESCE(raw, ''), '^[[:space:]]*[[:alnum:]]{1,2}[[:space:]]*[).:–-][[:space:]]*', ''))
$$;

-- Resolve any answer representation into 'A'..'F' (NULL when not an option).
CREATE OR REPLACE FUNCTION public.ph_answer_letter(raw TEXT, options JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v        TEXT := btrim(COALESCE(raw, ''));
  v_alpha  TEXT;
  letters  TEXT[] := ARRAY['A','B','C','D','E','F'];
  n        INTEGER;
  idx      INTEGER;
  target   TEXT;
  opt      TEXT;
BEGIN
  IF v = '' THEN RETURN NULL; END IF;

  -- Plain latin letter, optionally followed by a separator: "A", "b)"
  IF v ~ '^[A-Fa-f][[:space:]]*[).:–-]?[[:space:]]*$' THEN
    RETURN upper(left(v, 1));
  END IF;

  -- Arabic option letters (strip every non-letter first)
  v_alpha := regexp_replace(v, '[^[:alpha:]]', '', 'g');
  IF v_alpha IN ('أ','ا') THEN RETURN 'A'; END IF;
  IF v_alpha = 'ب' THEN RETURN 'B'; END IF;
  IF v_alpha = 'ج' THEN RETURN 'C'; END IF;
  IF v_alpha = 'د' THEN RETURN 'D'; END IF;

  -- Numeric index ("1" -> A, "0" -> A)
  IF public.ph_norm_text(v) ~ '^[0-9]{1,2}$' THEN
    n := public.ph_norm_text(v)::INTEGER;
    IF n = 0 THEN RETURN 'A'; END IF;
    IF n BETWEEN 1 AND 6 THEN RETURN letters[n]; END IF;
  END IF;

  -- Prefixed option label ("A) Ampere")
  IF v ~ '^[[:space:]]*[A-Fa-f][[:space:]]*[).:–-][[:space:]]*' THEN
    RETURN upper(left(btrim(v), 1));
  END IF;

  -- Full option text -> position inside the option list
  target := public.ph_norm_text(public.ph_strip_option_prefix(v));
  IF target IS NOT NULL AND options IS NOT NULL AND jsonb_typeof(options) = 'array' THEN
    FOR idx IN 0 .. jsonb_array_length(options) - 1 LOOP
      opt := public.ph_norm_text(public.ph_strip_option_prefix(options ->> idx));
      IF opt IS NOT NULL AND opt = target THEN
        RETURN letters[idx + 1];
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. THE MARKER
--    Compares an answers map with a questions array and returns the
--    complete breakdown. Shared by every grading entry point below.
--
--    questions : [{ id, question, options[], answer|correctAnswer, points }]
--    answers   : { "<question id or 1-based number>": "A" }
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ph_mark_answers(questions JSONB, answers JSONB)
RETURNS TABLE (
  total_questions  INTEGER,
  correct_count    INTEGER,
  incorrect_count  INTEGER,
  unanswered_count INTEGER,
  score            NUMERIC,
  total_points     NUMERIC,
  percentage       NUMERIC,
  breakdown        JSONB
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  q              JSONB;
  i              INTEGER := 0;
  q_id           TEXT;
  q_options      JSONB;
  q_points       NUMERIC;
  key_raw        TEXT;
  key_letter     TEXT;
  key_text       TEXT;
  stu_raw        TEXT;
  stu_letter     TEXT;
  answered       BOOLEAN;
  correct        BOOLEAN;
  items          JSONB := '[]'::jsonb;
BEGIN
  total_questions  := 0;
  correct_count    := 0;
  incorrect_count  := 0;
  unanswered_count := 0;
  score            := 0;
  total_points     := 0;

  IF questions IS NULL OR jsonb_typeof(questions) <> 'array' THEN
    percentage := 0;
    breakdown  := items;
    RETURN NEXT;
    RETURN;
  END IF;

  FOR q IN SELECT * FROM jsonb_array_elements(questions) LOOP
    i          := i + 1;
    q_id       := COALESCE(q ->> 'id', i::TEXT);
    q_options  := CASE WHEN jsonb_typeof(q -> 'options') = 'array' THEN q -> 'options' ELSE '[]'::jsonb END;
    q_points   := COALESCE(NULLIF(q ->> 'points', '')::NUMERIC, 1);
    IF q_points <= 0 THEN q_points := 1; END IF;

    key_raw    := COALESCE(NULLIF(q ->> 'answer', ''), NULLIF(q ->> 'correctAnswer', ''), NULLIF(q ->> 'correct', ''), '');
    key_letter := public.ph_answer_letter(key_raw, q_options);
    key_text   := public.ph_norm_text(public.ph_strip_option_prefix(key_raw));

    stu_raw    := COALESCE(answers ->> q_id, answers ->> i::TEXT, answers ->> ('q' || i::TEXT), '');
    stu_letter := public.ph_answer_letter(stu_raw, q_options);
    answered   := btrim(stu_raw) <> '';

    total_questions := total_questions + 1;

    -- No key configured -> the question cannot be auto-marked
    IF key_letter IS NULL AND key_text IS NULL THEN
      correct := FALSE;
      IF NOT answered THEN unanswered_count := unanswered_count + 1; END IF;
      items := items || jsonb_build_object(
        'questionId', q_id, 'number', i, 'question', q ->> 'question',
        'points', q_points, 'hasKey', FALSE, 'answered', answered,
        'studentAnswer', stu_raw, 'studentLetter', stu_letter,
        'correctAnswer', NULL, 'isCorrect', FALSE, 'earnedPoints', 0
      );
      CONTINUE;
    END IF;

    total_points := total_points + q_points;

    IF NOT answered THEN
      correct := FALSE;
      unanswered_count := unanswered_count + 1;
      incorrect_count  := incorrect_count + 1;
    ELSIF key_letter IS NOT NULL THEN
      correct := (stu_letter IS NOT NULL AND stu_letter = key_letter)
              OR (stu_letter IS NULL AND public.ph_norm_text(public.ph_strip_option_prefix(stu_raw)) = key_text);
      IF correct THEN
        correct_count := correct_count + 1;
        score := score + q_points;
      ELSE
        incorrect_count := incorrect_count + 1;
      END IF;
    ELSE
      correct := public.ph_norm_text(public.ph_strip_option_prefix(stu_raw)) = key_text;
      IF correct THEN
        correct_count := correct_count + 1;
        score := score + q_points;
      ELSE
        incorrect_count := incorrect_count + 1;
      END IF;
    END IF;

    items := items || jsonb_build_object(
      'questionId', q_id, 'number', i, 'question', q ->> 'question',
      'points', q_points, 'hasKey', TRUE, 'answered', answered,
      'studentAnswer', stu_raw, 'studentLetter', stu_letter,
      'correctAnswer', COALESCE(key_letter, key_raw), 'isCorrect', correct,
      'earnedPoints', CASE WHEN correct THEN q_points ELSE 0 END
    );
  END LOOP;

  percentage := CASE WHEN total_points > 0 THEN ROUND(100.0 * score / total_points, 2) ELSE 0 END;
  breakdown  := items;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. ANTI-CHEAT TRIGGER — allow the server-side auto-marker
--    Students still cannot write their own score directly; only code
--    running inside the SECURITY DEFINER marker sets the flag below.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 5. STUDENT ENTRY POINT — hand in answers, get marked instantly
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grade_assignment_submission(
  p_assignment_id UUID,
  p_answers       JSONB,
  p_content       TEXT DEFAULT NULL,
  p_file_url      TEXT DEFAULT NULL,
  p_student_id    UUID DEFAULT NULL
)
RETURNS TABLE (
  total_questions  INTEGER,
  correct_count    INTEGER,
  incorrect_count  INTEGER,
  unanswered_count INTEGER,
  score            NUMERIC,
  total_points     NUMERIC,
  percentage       NUMERIC,
  breakdown        JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student   UUID := COALESCE(p_student_id, auth.uid());
  v_questions JSONB;
  v_published BOOLEAN;
  m           RECORD;
BEGIN
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only an admin may submit on behalf of somebody else
  IF v_student <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not allowed to submit for another student' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_answers, '{}'::jsonb)) <> 'object'
     OR pg_column_size(COALESCE(p_answers, '{}'::jsonb)) > 65536 THEN
    RAISE EXCEPTION 'Answers must be a JSON object no larger than 64 KB' USING ERRCODE = '22023';
  END IF;
  IF p_content IS NOT NULL AND char_length(p_content) > 20000 THEN
    RAISE EXCEPTION 'Submission text is too long' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_admin() THEN
    IF NOT public.can_access_assignment(p_assignment_id) THEN
      RAISE EXCEPTION 'This homework is not available to your account' USING ERRCODE = '42501';
    END IF;
    IF p_file_url IS NOT NULL AND p_file_url NOT LIKE auth.uid()::text || '/%' THEN
      RAISE EXCEPTION 'Invalid submission file path' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.submissions
      WHERE assignment_id = p_assignment_id AND student_id = v_student AND status = 'graded'
    ) THEN
      RAISE EXCEPTION 'This homework has already been graded' USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT COALESCE(questions, '[]'::jsonb), is_published
    INTO v_questions, v_published
  FROM public.assignments
  WHERE id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Homework entry % not found', p_assignment_id;
  END IF;

  IF NOT v_published AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'This homework is not published yet';
  END IF;

  SELECT * INTO m FROM public.ph_mark_answers(v_questions, COALESCE(p_answers, '{}'::jsonb));

  -- Let the marker write score/status past the anti-cheat trigger
  PERFORM set_config('physics_hub.autograde', 'on', true);

  INSERT INTO public.submissions AS s (
    assignment_id, student_id, content, file_url, answers, status, score,
    total_points, correct_count, incorrect_count, unanswered_count,
    percentage, breakdown, auto_graded, submitted_at, graded_at
  )
  VALUES (
    p_assignment_id, v_student, p_content, p_file_url, COALESCE(p_answers, '{}'::jsonb),
    CASE WHEN m.total_points > 0 THEN 'graded' ELSE 'submitted' END,
    m.score, m.total_points, m.correct_count, m.incorrect_count, m.unanswered_count,
    m.percentage, m.breakdown, m.total_points > 0, now(),
    CASE WHEN m.total_points > 0 THEN now() ELSE NULL END
  )
  ON CONFLICT (assignment_id, student_id) DO UPDATE SET
    content          = EXCLUDED.content,
    file_url         = COALESCE(EXCLUDED.file_url, s.file_url),
    answers          = EXCLUDED.answers,
    status           = EXCLUDED.status,
    score            = EXCLUDED.score,
    total_points     = EXCLUDED.total_points,
    correct_count    = EXCLUDED.correct_count,
    incorrect_count  = EXCLUDED.incorrect_count,
    unanswered_count = EXCLUDED.unanswered_count,
    percentage       = EXCLUDED.percentage,
    breakdown        = EXCLUDED.breakdown,
    auto_graded      = EXCLUDED.auto_graded,
    submitted_at     = now(),
    graded_at        = EXCLUDED.graded_at;

  PERFORM set_config('physics_hub.autograde', 'off', true);

  total_questions  := m.total_questions;
  correct_count    := m.correct_count;
  incorrect_count  := m.incorrect_count;
  unanswered_count := m.unanswered_count;
  score            := m.score;
  total_points     := m.total_points;
  percentage       := m.percentage;
  breakdown        := m.breakdown;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.grade_assignment_submission(UUID, JSONB, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_assignment_submission(UUID, JSONB, TEXT, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. LESSON HOMEWORK (homework_submissions) — same marking rules
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grade_lesson_homework(
  p_lesson_id  UUID,
  p_answers    JSONB,
  p_student_id UUID DEFAULT NULL
)
RETURNS TABLE (
  total_questions  INTEGER,
  correct_count    INTEGER,
  incorrect_count  INTEGER,
  unanswered_count INTEGER,
  score            NUMERIC,
  total_points     NUMERIC,
  percentage       NUMERIC,
  breakdown        JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student   UUID := COALESCE(p_student_id, auth.uid());
  v_questions JSONB;
  v_model     JSONB;
  m           RECORD;
BEGIN
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_student <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not allowed to submit for another student' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_answers, '{}'::jsonb)) <> 'object'
     OR pg_column_size(COALESCE(p_answers, '{}'::jsonb)) > 65536 THEN
    RAISE EXCEPTION 'Answers must be a JSON object no larger than 64 KB' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.lessons l
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE l.id = p_lesson_id AND p.role = 'student' AND p.is_active = true AND p.year_id = l.year_id
    ) THEN
      RAISE EXCEPTION 'This lesson homework is not available to your account' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.homework_submissions
      WHERE lesson_id = p_lesson_id AND student_id = v_student
    ) THEN
      RAISE EXCEPTION 'This lesson homework has already been submitted' USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT COALESCE(homework_questions, '[]'::jsonb), COALESCE(model_answers, '{}'::jsonb)
    INTO v_questions, v_model
  FROM public.lessons
  WHERE id = p_lesson_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lesson % not found', p_lesson_id;
  END IF;

  -- The lesson-level model_answers map wins over the per-question key.
  IF jsonb_typeof(v_model) = 'object' AND v_model <> '{}'::jsonb THEN
    SELECT COALESCE(jsonb_agg(
             q || jsonb_build_object(
               'answer',
               COALESCE(
                 v_model ->> COALESCE(q ->> 'id', ord::TEXT),
                 v_model ->> ord::TEXT,
                 q ->> 'answer',
                 q ->> 'correctAnswer'
               )
             ) ORDER BY ord
           ), '[]'::jsonb)
      INTO v_questions
    FROM jsonb_array_elements(v_questions) WITH ORDINALITY AS t(q, ord);

    -- Lesson has a key but no question objects: synthesise them
    IF v_questions = '[]'::jsonb THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', k, 'answer', val, 'points', 1)), '[]'::jsonb)
        INTO v_questions
      FROM jsonb_each_text(v_model) AS e(k, val);
    END IF;
  END IF;

  SELECT * INTO m FROM public.ph_mark_answers(v_questions, COALESCE(p_answers, '{}'::jsonb));

  INSERT INTO public.homework_submissions AS h (
    lesson_id, student_id, answers, score, total_questions, total_points,
    correct_count, incorrect_count, unanswered_count, percentage, breakdown,
    auto_graded, submitted_at
  )
  VALUES (
    p_lesson_id, v_student, COALESCE(p_answers, '{}'::jsonb), m.score, m.total_questions,
    m.total_points, m.correct_count, m.incorrect_count, m.unanswered_count,
    m.percentage, m.breakdown, m.total_points > 0, now()
  )
  ON CONFLICT (lesson_id, student_id) DO UPDATE SET
    answers          = EXCLUDED.answers,
    score            = EXCLUDED.score,
    total_questions  = EXCLUDED.total_questions,
    total_points     = EXCLUDED.total_points,
    correct_count    = EXCLUDED.correct_count,
    incorrect_count  = EXCLUDED.incorrect_count,
    unanswered_count = EXCLUDED.unanswered_count,
    percentage       = EXCLUDED.percentage,
    breakdown        = EXCLUDED.breakdown,
    auto_graded      = EXCLUDED.auto_graded,
    submitted_at     = now();

  total_questions  := m.total_questions;
  correct_count    := m.correct_count;
  incorrect_count  := m.incorrect_count;
  unanswered_count := m.unanswered_count;
  score            := m.score;
  total_points     := m.total_points;
  percentage       := m.percentage;
  breakdown        := m.breakdown;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.grade_lesson_homework(UUID, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_lesson_homework(UUID, JSONB, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. TEACHER TOOLS — re-mark everything after fixing the answer key
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regrade_assignment(p_assignment_id UUID)
RETURNS TABLE (student_id UUID, score NUMERIC, correct_count INTEGER, incorrect_count INTEGER, percentage NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_questions JSONB;
  r           RECORD;
  m           RECORD;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  SELECT COALESCE(questions, '[]'::jsonb) INTO v_questions
  FROM public.assignments WHERE id = p_assignment_id;

  PERFORM set_config('physics_hub.autograde', 'on', true);

  FOR r IN SELECT id, s.student_id AS sid, COALESCE(answers, '{}'::jsonb) AS answers
           FROM public.submissions s WHERE s.assignment_id = p_assignment_id LOOP
    SELECT * INTO m FROM public.ph_mark_answers(v_questions, r.answers);

    UPDATE public.submissions SET
      score            = m.score,
      total_points     = m.total_points,
      correct_count    = m.correct_count,
      incorrect_count  = m.incorrect_count,
      unanswered_count = m.unanswered_count,
      percentage       = m.percentage,
      breakdown        = m.breakdown,
      auto_graded      = TRUE,
      status           = CASE WHEN m.total_points > 0 THEN 'graded' ELSE status END,
      graded_at        = now()
    WHERE id = r.id;

    student_id      := r.sid;
    score           := m.score;
    correct_count   := m.correct_count;
    incorrect_count := m.incorrect_count;
    percentage      := m.percentage;
    RETURN NEXT;
  END LOOP;

  PERFORM set_config('physics_hub.autograde', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.regrade_assignment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regrade_assignment(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.regrade_lesson_homework(p_lesson_id UUID)
RETURNS TABLE (student_id UUID, score NUMERIC, correct_count INTEGER, incorrect_count INTEGER, percentage NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  m RECORD;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  FOR r IN SELECT h.student_id AS sid FROM public.homework_submissions h WHERE h.lesson_id = p_lesson_id LOOP
    SELECT * INTO m FROM public.grade_lesson_homework(
      p_lesson_id,
      (SELECT COALESCE(answers, '{}'::jsonb) FROM public.homework_submissions
        WHERE lesson_id = p_lesson_id AND homework_submissions.student_id = r.sid),
      r.sid
    );
    student_id      := r.sid;
    score           := m.score;
    correct_count   := m.correct_count;
    incorrect_count := m.incorrect_count;
    percentage      := m.percentage;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.regrade_lesson_homework(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regrade_lesson_homework(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. REPORTING VIEW — class results per homework entry, by correctness
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.homework_marking_report
WITH (security_invoker = true) AS
SELECT
  a.id                         AS assignment_id,
  a.title                      AS assignment_title,
  a.year_id,
  a.group_name,
  COALESCE(a.total_points, a.max_score) AS total_points,
  COUNT(s.id)                  AS submissions_count,
  COUNT(s.id) FILTER (WHERE s.status = 'graded')       AS graded_count,
  COALESCE(SUM(s.correct_count), 0)                    AS total_correct,
  COALESCE(SUM(s.incorrect_count), 0)                  AS total_incorrect,
  ROUND(AVG(s.percentage) FILTER (WHERE s.percentage IS NOT NULL), 1) AS average_percent,
  MAX(s.percentage)            AS highest_percent,
  MIN(s.percentage)            AS lowest_percent
FROM public.assignments a
LEFT JOIN public.submissions s ON s.assignment_id = a.id
GROUP BY a.id;

REVOKE ALL ON public.homework_marking_report FROM PUBLIC, anon;
GRANT SELECT ON public.homework_marking_report TO authenticated;

-- Done. Verify with:
--   SELECT * FROM public.ph_mark_answers(
--     '[{"id":"q1","options":["A) Ampere","B) Volt"],"answer":"A","points":5},
--       {"id":"q2","options":["A) Ampere","B) Volt"],"answer":"B","points":5}]'::jsonb,
--     '{"q1":"A","q2":"A"}'::jsonb);
--   -> 1 correct, 1 incorrect, score 5/10, percentage 50.00
