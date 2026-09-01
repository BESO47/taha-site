-- =====================================================================
-- Physics Hub - Eng Taha Elsabagh  |  physics بطريقه مختلفه
-- NESTED MCQ SUBPOINTS  +  ADMIN ANSWER EDITING (with audit trail)
-- ---------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES
--   1. SECURITY FIX — `strip_assessment_answers()` now also removes the
--      correct answer of every nested subpoint. Before this change only
--      top-level `answer` keys were stripped, so `homework_catalog`
--      leaked subpoint answer keys to students.
--   2. `ph_answer_letter` helpers for reading a student's answer out of
--      either the flat `{ "q1": "B" }` shape or the nested
--      `{ "q1": { "answer": "B", "subpoints": { "sp_1": "C" } } }` shape.
--   3. `ph_roman()` — the same lowercase roman numeral generator the
--      client uses (i, ii, iii, …) so stored breakdowns carry the label
--      the UI shows.
--   4. `ph_mark_answers()` is now subpoint aware. Every subpoint is
--      marked independently; a question with subpoints is worth the SUM
--      of its subpoint points (its own `points` is ignored), so nothing
--      is ever double counted. Questions WITHOUT subpoints are marked
--      exactly as before — old homework and old submissions are untouched.
--   5. `submission_answer_edits` — append-only audit table recording who
--      changed which answer, from what to what, and when.
--   6. `admin_update_submission_answer()` — the ONLY way to modify a
--      submitted answer. It verifies `is_admin()` server-side, changes one
--      single question/subpoint answer, re-marks the whole paper and
--      writes the audit row. Students calling it get an authorization
--      error, not a silent no-op.
--
-- BACKWARD COMPATIBILITY
--   No column is dropped, no table is recreated and no existing row is
--   rewritten. `assignments.questions` stays a JSONB array; subpoints are
--   an OPTIONAL key inside a question object. A question without the key
--   behaves identically to before.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--   (Idempotent: safe to run more than once.
--    Run AFTER schema.sql and homework-grading.sql.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ANSWER-KEY REDACTION — now recursive into subpoints
--    Used by public.homework_catalog / public.lesson_catalog for every
--    non-admin reader. Students must receive the question, its options
--    and its points — never the key.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.strip_assessment_answers(payload JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN jsonb_typeof(payload) <> 'array' THEN '[]'::jsonb
    ELSE COALESCE(
      (SELECT jsonb_agg(
         -- subpoints first: strip the key of every nested MCQ, then drop
         -- the question's own key spellings.
         (CASE
            WHEN jsonb_typeof(item -> 'subpoints') = 'array'
            THEN item || jsonb_build_object(
                   'subpoints',
                   COALESCE(
                     (SELECT jsonb_agg(
                        sp - 'answer' - 'correctAnswer' - 'correct' - 'correct_answer' - 'key' - 'modelAnswer'
                        ORDER BY sp_ord)
                      FROM jsonb_array_elements(item -> 'subpoints')
                           WITH ORDINALITY AS s(sp, sp_ord)),
                     '[]'::jsonb
                   )
                 )
            ELSE item
          END)
         - 'answer' - 'correctAnswer' - 'correct' - 'correct_answer' - 'key' - 'modelAnswer'
         ORDER BY ord)
       FROM jsonb_array_elements(payload) WITH ORDINALITY AS q(item, ord)),
      '[]'::jsonb
    )
  END
$$;

-- ---------------------------------------------------------------------
-- 2. ANSWER READ HELPERS
-- ---------------------------------------------------------------------

-- Lowercase roman numeral for a 1-based position: 1 -> 'i', 2 -> 'ii', …
-- Mirrors romanNumeral() in src/lib/grading.js.
CREATE OR REPLACE FUNCTION public.ph_roman(n INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  rest INTEGER := n;
  out  TEXT   := '';
  vals INTEGER[] := ARRAY[1000,900,500,400,100,90,50,40,10,9,5,4,1];
  gl   TEXT[]   := ARRAY['m','cm','d','cd','c','xc','l','xl','x','ix','v','iv','i'];
  k    INTEGER;
BEGIN
  IF n IS NULL OR n < 1 THEN RETURN ''; END IF;
  IF n > 3999 THEN RETURN n::TEXT; END IF;
  FOR k IN 1 .. array_length(vals, 1) LOOP
    WHILE rest >= vals[k] LOOP
      out  := out || gl[k];
      rest := rest - vals[k];
    END LOOP;
  END LOOP;
  RETURN out;
END;
$$;

-- The raw JSONB node stored for one question: either a scalar letter or
-- the nested { answer, subpoints } object.
CREATE OR REPLACE FUNCTION public.ph_answer_node(answers JSONB, q_id TEXT, q_index INTEGER)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    answers -> q_id,
    answers -> q_index::TEXT,
    answers -> ('q' || q_index::TEXT)
  )
$$;

-- Scalar answer text out of a node (unwraps the nested object).
CREATE OR REPLACE FUNCTION public.ph_answer_text(node JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN node IS NULL THEN ''
    WHEN jsonb_typeof(node) = 'object'
      THEN COALESCE(node ->> 'answer', node ->> 'value', node ->> 'choice', node ->> 'letter', '')
    ELSE COALESCE(node #>> '{}', '')
  END
$$;

-- One subpoint's answer. The STABLE subpoint id is tried first; array
-- positions and roman labels are only fallbacks so re-ordering or
-- deleting subpoints can never re-map a student's answers.
CREATE OR REPLACE FUNCTION public.ph_subpoint_answer(
  node      JSONB,
  answers   JSONB,
  q_id      TEXT,
  q_index   INTEGER,
  sp_id     TEXT,
  sp_index  INTEGER,
  sp_label  TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  bag JSONB;
  v   TEXT;
BEGIN
  IF node IS NOT NULL AND jsonb_typeof(node) = 'object' THEN
    bag := COALESCE(node -> 'subpoints', node -> 'sub', node -> 'items');
    IF bag IS NOT NULL AND jsonb_typeof(bag) = 'object' THEN
      v := bag ->> sp_id;
      IF v IS NULL AND sp_label <> '' THEN v := bag ->> sp_label; END IF;
      IF v IS NULL THEN v := bag ->> (sp_index + 1)::TEXT; END IF;
      IF v IS NOT NULL THEN RETURN v; END IF;
    END IF;
  END IF;

  -- Legacy flat keys written before the nested format existed.
  v := answers ->> (q_id || '.' || sp_id);
  IF v IS NULL THEN v := answers ->> (q_id || '.' || sp_index::TEXT); END IF;
  IF v IS NULL AND sp_label <> '' THEN v := answers ->> (q_id || '.' || sp_label); END IF;
  IF v IS NULL THEN v := answers ->> (q_index::TEXT || '.' || sp_id); END IF;

  RETURN COALESCE(v, '');
END;
$$;

-- ---------------------------------------------------------------------
-- 3. THE MARKER — subpoint aware
--    Same signature as before, so every existing caller
--    (grade_assignment_submission, grade_lesson_homework, regrade_*)
--    keeps working unchanged.
--
--    questions : [{ id, question, options[], answer, points,
--                   subpoints?: [{ id, question|text, options[4], answer, points }] }]
--    answers   : { "q1": "B" }                                    (flat)
--             or { "q1": { "answer": "", "subpoints": { "sp_1": "C" } } }
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
  -- subpoint state
  subs           JSONB;
  sp             JSONB;
  sp_j           INTEGER;
  sp_id          TEXT;
  sp_label       TEXT;
  sp_options     JSONB;
  sp_points      NUMERIC;
  sp_key_raw     TEXT;
  sp_key_letter  TEXT;
  sp_key_text    TEXT;
  sp_stu_raw     TEXT;
  sp_stu_letter  TEXT;
  sp_answered    BOOLEAN;
  sp_correct     BOOLEAN;
  sp_has_key     BOOLEAN;
  sp_items       JSONB;
  sp_earned      NUMERIC;
  sp_total       NUMERIC;
  sp_keyed       BOOLEAN;
  sp_any         BOOLEAN;
  node           JSONB;
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
    i      := i + 1;
    q_id   := COALESCE(q ->> 'id', i::TEXT);
    node   := public.ph_answer_node(answers, q_id, i);

    total_questions := total_questions + 1;

    /* -----------------------------------------------------------------
     * QUESTION WITH NESTED SUBPOINTS — each subpoint marked on its own.
     * The parent contributes the SUM of its subpoint points only.
     * ----------------------------------------------------------------- */
    subs := CASE WHEN jsonb_typeof(q -> 'subpoints') = 'array' THEN q -> 'subpoints' ELSE '[]'::jsonb END;

    IF jsonb_array_length(subs) > 0 THEN
      sp_items  := '[]'::jsonb;
      sp_earned := 0;
      sp_total  := 0;
      sp_keyed  := FALSE;
      sp_any    := FALSE;
      sp_j      := 0;

      FOR sp IN SELECT * FROM jsonb_array_elements(subs) LOOP
        sp_j         := sp_j + 1;
        sp_id        := COALESCE(sp ->> 'id', q_id || '_' || sp_j::TEXT);
        sp_label     := public.ph_roman(sp_j);
        sp_options   := CASE WHEN jsonb_typeof(sp -> 'options') = 'array' THEN sp -> 'options' ELSE '[]'::jsonb END;
        sp_points    := COALESCE(NULLIF(sp ->> 'points', '')::NUMERIC, 1);
        IF sp_points <= 0 THEN sp_points := 1; END IF;

        sp_key_raw    := COALESCE(
                           NULLIF(sp ->> 'answer', ''), NULLIF(sp ->> 'correctAnswer', ''),
                           NULLIF(sp ->> 'correct', ''), '');
        sp_key_letter := public.ph_answer_letter(sp_key_raw, sp_options);
        sp_key_text   := public.ph_norm_text(public.ph_strip_option_prefix(sp_key_raw));
        sp_has_key    := sp_key_letter IS NOT NULL OR sp_key_text IS NOT NULL;

        sp_stu_raw    := public.ph_subpoint_answer(node, answers, q_id, i, sp_id, sp_j - 1, sp_label);
        sp_stu_letter := public.ph_answer_letter(sp_stu_raw, sp_options);
        sp_answered   := btrim(COALESCE(sp_stu_raw, '')) <> '';

        IF sp_answered THEN sp_any := TRUE; END IF;

        IF NOT sp_has_key THEN
          sp_correct := FALSE;
          IF NOT sp_answered THEN unanswered_count := unanswered_count + 1; END IF;
          sp_items := sp_items || jsonb_build_object(
            'subpointId', sp_id, 'label', sp_label, 'number', sp_j,
            'question', COALESCE(sp ->> 'question', sp ->> 'text'),
            'options', sp_options, 'points', sp_points, 'hasKey', FALSE,
            'answered', sp_answered, 'studentAnswer', COALESCE(sp_stu_raw, ''),
            'studentLetter', sp_stu_letter, 'correctAnswer', NULL,
            'isCorrect', FALSE, 'earnedPoints', 0
          );
          CONTINUE;
        END IF;

        sp_keyed   := TRUE;
        sp_total   := sp_total + sp_points;
        total_points := total_points + sp_points;

        IF NOT sp_answered THEN
          sp_correct := FALSE;
          unanswered_count := unanswered_count + 1;
          incorrect_count  := incorrect_count + 1;
        ELSIF sp_key_letter IS NOT NULL THEN
          sp_correct := (sp_stu_letter IS NOT NULL AND sp_stu_letter = sp_key_letter)
                     OR (sp_stu_letter IS NULL
                         AND public.ph_norm_text(public.ph_strip_option_prefix(sp_stu_raw)) = sp_key_text);
          IF sp_correct THEN
            correct_count := correct_count + 1;
            sp_earned     := sp_earned + sp_points;
            score         := score + sp_points;
          ELSE
            incorrect_count := incorrect_count + 1;
          END IF;
        ELSE
          sp_correct := public.ph_norm_text(public.ph_strip_option_prefix(sp_stu_raw)) = sp_key_text;
          IF sp_correct THEN
            correct_count := correct_count + 1;
            sp_earned     := sp_earned + sp_points;
            score         := score + sp_points;
          ELSE
            incorrect_count := incorrect_count + 1;
          END IF;
        END IF;

        sp_items := sp_items || jsonb_build_object(
          'subpointId', sp_id, 'label', sp_label, 'number', sp_j,
          'question', COALESCE(sp ->> 'question', sp ->> 'text'),
          'options', sp_options, 'points', sp_points, 'hasKey', TRUE,
          'answered', sp_answered, 'studentAnswer', COALESCE(sp_stu_raw, ''),
          'studentLetter', sp_stu_letter,
          'correctAnswer', COALESCE(sp_key_letter, sp_key_raw),
          'isCorrect', sp_correct,
          'earnedPoints', CASE WHEN sp_correct THEN sp_points ELSE 0 END
        );
      END LOOP;

      items := items || jsonb_build_object(
        'questionId', q_id, 'number', i, 'question', q ->> 'question',
        'options', CASE WHEN jsonb_typeof(q -> 'options') = 'array' THEN q -> 'options' ELSE '[]'::jsonb END,
        'points', sp_total, 'hasKey', sp_keyed, 'hasSubpoints', TRUE,
        'answered', sp_any, 'studentAnswer', '', 'studentLetter', NULL,
        'correctAnswer', NULL,
        -- A parent is only "correct" when every subpoint was answered right.
        'isCorrect', sp_keyed AND sp_total > 0 AND sp_earned = sp_total,
        'earnedPoints', sp_earned, 'subpoints', sp_items
      );
      CONTINUE;
    END IF;

    /* --------------------- NORMAL (FLAT) QUESTION --------------------- */
    q_options  := CASE WHEN jsonb_typeof(q -> 'options') = 'array' THEN q -> 'options' ELSE '[]'::jsonb END;
    q_points   := COALESCE(NULLIF(q ->> 'points', '')::NUMERIC, 1);
    IF q_points <= 0 THEN q_points := 1; END IF;

    key_raw    := COALESCE(NULLIF(q ->> 'answer', ''), NULLIF(q ->> 'correctAnswer', ''), NULLIF(q ->> 'correct', ''), '');
    key_letter := public.ph_answer_letter(key_raw, q_options);
    key_text   := public.ph_norm_text(public.ph_strip_option_prefix(key_raw));

    stu_raw    := public.ph_answer_text(node);
    stu_letter := public.ph_answer_letter(stu_raw, q_options);
    answered   := btrim(COALESCE(stu_raw, '')) <> '';

    -- No key configured -> the question cannot be auto-marked
    IF key_letter IS NULL AND key_text IS NULL THEN
      correct := FALSE;
      IF NOT answered THEN unanswered_count := unanswered_count + 1; END IF;
      items := items || jsonb_build_object(
        'questionId', q_id, 'number', i, 'question', q ->> 'question',
        'points', q_points, 'hasKey', FALSE, 'hasSubpoints', FALSE, 'answered', answered,
        'studentAnswer', stu_raw, 'studentLetter', stu_letter,
        'correctAnswer', NULL, 'isCorrect', FALSE, 'earnedPoints', 0,
        'subpoints', '[]'::jsonb
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
      'points', q_points, 'hasKey', TRUE, 'hasSubpoints', FALSE, 'answered', answered,
      'studentAnswer', stu_raw, 'studentLetter', stu_letter,
      'correctAnswer', COALESCE(key_letter, key_raw), 'isCorrect', correct,
      'earnedPoints', CASE WHEN correct THEN q_points ELSE 0 END,
      'subpoints', '[]'::jsonb
    );
  END LOOP;

  percentage := CASE WHEN total_points > 0 THEN ROUND(100.0 * score / total_points, 2) ELSE 0 END;
  breakdown  := items;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. AUDIT TABLE — append-only history of admin answer changes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.submission_answer_edits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES public.submissions(id)  ON DELETE CASCADE,
  assignment_id   UUID NOT NULL REFERENCES public.assignments(id)  ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES public.profiles(id)     ON DELETE CASCADE,
  question_id     TEXT NOT NULL,
  subpoint_id     TEXT,
  previous_answer TEXT,
  new_answer      TEXT NOT NULL,
  score_before    NUMERIC(8,2),
  score_after     NUMERIC(8,2),
  changed_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submission_answer_edits_submission_idx
  ON public.submission_answer_edits(submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS submission_answer_edits_student_idx
  ON public.submission_answer_edits(student_id, created_at DESC);

-- The history is immutable: there is deliberately no UPDATE or DELETE
-- policy, and the trigger below refuses both even for a superuser-ish
-- direct call, so neither a student nor a compromised client can rewrite
-- or erase the trail.
CREATE OR REPLACE FUNCTION public.guard_answer_edit_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Answer edit history is append-only' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS submission_answer_edits_immutable ON public.submission_answer_edits;
CREATE TRIGGER submission_answer_edits_immutable
  BEFORE UPDATE OR DELETE ON public.submission_answer_edits
  FOR EACH ROW EXECUTE FUNCTION public.guard_answer_edit_history();

ALTER TABLE public.submission_answer_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "submission_answer_edits: admin read" ON public.submission_answer_edits;
CREATE POLICY "submission_answer_edits: admin read" ON public.submission_answer_edits
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- No INSERT/UPDATE/DELETE policy at all: the only writer is the
-- SECURITY DEFINER RPC below, which runs as the table owner.
REVOKE ALL ON public.submission_answer_edits FROM PUBLIC, anon;
GRANT SELECT ON public.submission_answer_edits TO authenticated;

-- ---------------------------------------------------------------------
-- 5. ADMIN ANSWER EDITING — the only path that can change a submitted
--    answer. Authorization is enforced HERE, in the database, not by
--    hiding a button in the UI.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_submission_answer(
  p_submission_id UUID,
  p_question_id   TEXT,
  p_subpoint_id   TEXT     DEFAULT NULL,
  p_new_answer    TEXT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin        UUID := auth.uid();
  v_sub          RECORD;
  v_questions    JSONB;
  v_answers      JSONB;
  v_q            JSONB;
  v_sp           JSONB;
  v_target       JSONB;               -- question or subpoint definition
  v_options      JSONB;
  v_node         JSONB;
  v_prev         TEXT;
  v_new          TEXT;
  v_q_id         TEXT := btrim(COALESCE(p_question_id, ''));
  v_sp_id        TEXT := btrim(COALESCE(p_subpoint_id, ''));
  v_score_before NUMERIC;
  v_status_after TEXT;
  m              RECORD;
  v_edit_id      UUID;
BEGIN
  -- ---------- authorization (server side, never trusts the client) ----
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can edit submitted answers' USING ERRCODE = '42501';
  END IF;

  -- ---------- input validation ---------------------------------------
  IF v_q_id = '' THEN
    RAISE EXCEPTION 'A question id is required' USING ERRCODE = '22023';
  END IF;
  v_new := btrim(COALESCE(p_new_answer, ''));
  IF v_new = '' THEN
    RAISE EXCEPTION 'A new answer is required' USING ERRCODE = '22023';
  END IF;

  -- ---------- load the submission (locked) ----------------------------
  SELECT s.id, s.assignment_id, s.student_id, s.answers, s.score, s.status,
         COALESCE(a.questions, '[]'::jsonb) AS questions
    INTO v_sub
  FROM public.submissions s
  JOIN public.assignments a ON a.id = s.assignment_id
  WHERE s.id = p_submission_id
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission % not found', p_submission_id USING ERRCODE = 'P0002';
  END IF;

  v_questions    := v_sub.questions;
  v_answers      := COALESCE(v_sub.answers, '{}'::jsonb);
  v_score_before := v_sub.score;

  -- ---------- resolve the question by its STABLE id -------------------
  SELECT item INTO v_q
  FROM jsonb_array_elements(v_questions) AS item
  WHERE COALESCE(item ->> 'id', '') = v_q_id;

  IF v_q IS NULL THEN
    -- Legacy keys are positional ("1", "2", …) rather than stored ids.
    SELECT item INTO v_q
    FROM jsonb_array_elements(v_questions) WITH ORDINALITY AS t(item, ord)
    WHERE ord::TEXT = v_q_id;
  END IF;

  IF v_q IS NULL THEN
    RAISE EXCEPTION 'Question % is not part of this homework', p_question_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ---------- resolve subpoint (if any) and the answer options --------
  IF v_sp_id <> '' THEN
    SELECT item INTO v_sp
    FROM jsonb_array_elements(COALESCE(v_q -> 'subpoints', '[]'::jsonb)) AS item
    WHERE COALESCE(item ->> 'id', '') = v_sp_id;

    IF v_sp IS NULL THEN
      RAISE EXCEPTION 'Subpoint % is not part of question %', p_subpoint_id, p_question_id
        USING ERRCODE = 'P0002';
    END IF;
    v_target  := v_sp;
  ELSE
    v_target := v_q;
  END IF;

  v_options := CASE WHEN jsonb_typeof(v_target -> 'options') = 'array'
                    THEN v_target -> 'options' ELSE '[]'::jsonb END;

  -- An MCQ answer must be one of the real options; store the canonical
  -- letter so the marker and the UI always agree.
  IF jsonb_array_length(v_options) > 0 THEN
    IF public.ph_answer_letter(v_new, v_options) IS NULL THEN
      RAISE EXCEPTION 'Answer must be one of the available options' USING ERRCODE = '22023';
    END IF;
    v_new := public.ph_answer_letter(v_new, v_options);
  END IF;

  -- ---------- write exactly ONE answer, leave the rest untouched ------
  v_node := v_answers -> v_q_id;
  IF v_node IS NULL THEN
    -- The student may never have answered this question at all.
    v_node := CASE WHEN v_answers ? v_q_id THEN to_jsonb(v_answers ->> v_q_id) ELSE NULL END;
  END IF;

  IF v_sp_id = '' THEN
    v_prev := public.ph_answer_text(v_node);
    IF jsonb_typeof(v_node) = 'object' THEN
      v_answers := jsonb_set(v_answers, ARRAY[v_q_id, 'answer'], to_jsonb(v_new));
    ELSE
      v_answers := jsonb_set(v_answers, ARRAY[v_q_id], to_jsonb(v_new), true);
    END IF;
  ELSE
    v_prev := public.ph_subpoint_answer(
      v_node, v_answers, v_q_id,
      (SELECT ord::INTEGER - 1 FROM jsonb_array_elements(v_questions) WITH ORDINALITY AS t(item, ord)
        WHERE COALESCE(item ->> 'id', '') = v_q_id OR ord::TEXT = v_q_id LIMIT 1),
      v_sp_id,
      COALESCE((SELECT ord::INTEGER - 1 FROM jsonb_array_elements(COALESCE(v_q -> 'subpoints', '[]'::jsonb))
                  WITH ORDINALITY AS t(item, ord) WHERE COALESCE(item ->> 'id', '') = v_sp_id LIMIT 1), 0),
      COALESCE((SELECT public.ph_roman(ord::INTEGER) FROM jsonb_array_elements(COALESCE(v_q -> 'subpoints', '[]'::jsonb))
                  WITH ORDINALITY AS t(item, ord) WHERE COALESCE(item ->> 'id', '') = v_sp_id LIMIT 1), '')
    );

    IF v_node IS NULL OR jsonb_typeof(v_node) <> 'object' THEN
      v_node := jsonb_build_object('answer', public.ph_answer_text(v_node), 'subpoints', '{}'::jsonb);
    END IF;
    v_node    := jsonb_set(v_node, ARRAY['subpoints', v_sp_id], to_jsonb(v_new), true);
    v_answers := jsonb_set(v_answers, ARRAY[v_q_id], v_node, true);
  END IF;

  IF v_prev = v_new THEN
    RAISE EXCEPTION 'The new answer is the same as the current one' USING ERRCODE = '22023';
  END IF;

  IF pg_column_size(v_answers) > 65536 THEN
    RAISE EXCEPTION 'Answers must be a JSON object no larger than 64 KB' USING ERRCODE = '22023';
  END IF;

  -- ---------- automatic re-grading of the WHOLE paper -----------------
  SELECT * INTO m FROM public.ph_mark_answers(v_questions, v_answers);

  -- Let the marker write past the anti-cheat trigger.
  PERFORM set_config('physics_hub.autograde', 'on', true);

  -- 13.7: a paper the marker can score becomes 'graded'; a paper without
  -- an answer key keeps whatever status it already had, so an ungraded
  -- submission is never silently marked as graded.
  v_status_after := CASE WHEN m.total_points > 0 THEN 'graded' ELSE v_sub.status END;

  UPDATE public.submissions SET
    answers          = v_answers,
    score            = m.score,
    total_points     = m.total_points,
    correct_count    = m.correct_count,
    incorrect_count  = m.incorrect_count,
    unanswered_count = m.unanswered_count,
    percentage       = m.percentage,
    breakdown        = m.breakdown,
    auto_graded      = m.total_points > 0,
    status           = v_status_after,
    graded_at        = CASE WHEN m.total_points > 0 THEN now() ELSE graded_at END,
    updated_at       = now()
  WHERE id = p_submission_id;

  -- ---------- audit trail --------------------------------------------
  INSERT INTO public.submission_answer_edits (
    submission_id, assignment_id, student_id, question_id, subpoint_id,
    previous_answer, new_answer, score_before, score_after, changed_by
  ) VALUES (
    p_submission_id, v_sub.assignment_id, v_sub.student_id, v_q_id,
    NULLIF(v_sp_id, ''), NULLIF(v_prev, ''), v_new,
    v_score_before, m.score, v_admin
  )
  RETURNING id INTO v_edit_id;

  PERFORM set_config('physics_hub.autograde', 'off', true);

  RETURN jsonb_build_object(
    'ok',               true,
    'edit_id',          v_edit_id,
    'submission_id',    p_submission_id,
    'student_id',       v_sub.student_id,
    'question_id',      v_q_id,
    'subpoint_id',      NULLIF(v_sp_id, ''),
    'previous_answer',  NULLIF(v_prev, ''),
    'new_answer',       v_new,
    'score',            m.score,
    'total_points',     m.total_points,
    'correct_count',    m.correct_count,
    'incorrect_count',  m.incorrect_count,
    'unanswered_count', m.unanswered_count,
    'percentage',       m.percentage,
    'status',           v_status_after,
    'answers',          v_answers,
    'breakdown',        m.breakdown
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_submission_answer(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_submission_answer(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- Done. Verify with:
--   SELECT * FROM public.ph_mark_answers(
--     '[{"id":"q1","question":"Choose","points":1,"subpoints":[
--         {"id":"a","question":"i","options":["A) x","B) y","C) z","D) w"],"answer":"B","points":1},
--         {"id":"b","question":"ii","options":["A) x","B) y","C) z","D) w"],"answer":"C","points":1},
--         {"id":"c","question":"iii","options":["A) x","B) y","C) z","D) w"],"answer":"A","points":1}]}]'::jsonb,
--     '{"q1":{"answer":"","subpoints":{"a":"B","b":"A","c":"A"}}}'::jsonb);
--   -> correct 2, incorrect 1, score 2, total_points 3, percentage 66.67
