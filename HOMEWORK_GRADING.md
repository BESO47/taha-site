# Homework grading

Physics Hub grades multiple-choice homework in PostgreSQL, not in the browser.

## Flow

1. Admin stores questions/keys in `assignments.questions` or lesson homework fields.
2. Students read `homework_catalog`/`lesson_catalog`, which remove answer-key properties.
3. Answers are posted to `grade_assignment_submission()` or `grade_lesson_homework()`.
4. The RPC validates identity, eligibility, payload size, file path, and attempt status.
5. `ph_mark_answers()` normalizes Arabic/Latin letters, digits, option labels, and short text.
6. Weighted score/count/percentage/breakdown are stored under the grading-trigger bypass scoped to that transaction.
7. A graded assignment cannot be overwritten by the student.
8. The explanation URL is returned only after that student's assignment is graded.

Configured production mode does not fall back to client-computed scores. If the RPC is missing, submission fails with an instruction to apply `homework-grading.sql`.

## Question format

```json
{
  "id": "q1",
  "question": "SI unit of current?",
  "options": ["A) Ampere", "B) Volt", "C) Ohm", "D) Joule"],
  "answer": "A",
  "points": 5
}
```

Accepted key/answer representations include `A`–`F`, Arabic option letters, 0/1-based numeric indexes, prefixed labels, or matching option text. Missing keys are not awarded points.

## Nested MCQ subpoints

A question may carry an optional `subpoints` array. Each subpoint is a complete MCQ in its own right:

```json
{
  "id": "q2",
  "question": "Choose the correct answer for each of the following:",
  "points": 99,
  "subpoints": [
    { "id": "sp_a", "question": "Newton's first law?", "options": ["A) w", "B) x", "C) y", "D) z"], "answer": "B", "points": 1 },
    { "id": "sp_b", "question": "What is inertia?",    "options": ["A) w", "B) x", "C) y", "D) z"], "answer": "C", "points": 1 }
  ]
}
```

Marking rules (`ph_mark_answers` in SQL and `gradeSubmissionAgainstKey` in JS implement the same rules):

- Every subpoint is marked independently against its own key.
- A question **with** subpoints is worth `SUM(subpoint points)`; its own `points` is ignored, so nothing is double counted. In the example above the 99 is never used and the question is worth 2.
- A question **without** subpoints is worth its own `points`, exactly as before.
- `correct_count` / `incorrect_count` / `unanswered_count` are tallied per subpoint, so a three-subpoint question can read "2 correct, 1 incorrect".
- The parent is reported correct only when every subpoint was answered correctly.

Subpoints are numbered **i, ii, iii…** from their array position (`ph_roman()` in SQL, `romanNumeral()` in JS). The label is generated on read and never stored, so deleting or reordering subpoints re-numbers the survivors with no data migration and no answer re-mapping.

### Answer storage

Both shapes are accepted and may coexist in one submission; nothing is migrated:

```jsonc
// flat — a plain question
{ "q1": "A" }

// nested — a question with subpoints, keyed by stable subpoint id
{ "q2": { "answer": "", "subpoints": { "sp_a": "B", "sp_b": "C" } } }
```

Legacy flat subpoint keys written by earlier builds (`"q2.sp_a"`) are still read, so existing submissions keep grading correctly.

## Changing a submitted answer (admin only)

`admin_update_submission_answer(submission_id, question_id, subpoint_id, new_answer)` is the only path that can modify a submitted answer:

1. Verifies `is_admin()` in the database — a student calling it is rejected, and `anon` cannot invoke it at all.
2. Resolves the question and subpoint **by stable id**; an unknown id raises rather than guessing a position.
3. Validates the new answer against the item's real options and stores the canonical letter.
4. Re-marks the whole paper with `ph_mark_answers` and writes score, counts, percentage and breakdown.
5. Appends a row to `submission_answer_edits` (student, submission, question, subpoint, previous answer, new answer, admin, score before/after, timestamp). That table has no write policy and rejects `UPDATE`/`DELETE`, so the trail cannot be rewritten.
6. A paper the marker cannot score (no answer key) keeps its existing status instead of being promoted to `graded`.

### What the dialog is built from

`submissions.breakdown` stores the **marks** — it is written by `ph_mark_answers`
and, in older copies of that function, it carried no `options` array for a plain
question. Rendering the editor straight from those rows produced a dialog with an
empty choice list and a permanently disabled confirm button, which looked exactly
like "the admin cannot change a student's answer".

`buildReviewBreakdown()` (in `src/lib/grading.js`) closes that gap in the
application, so the editor works on every deployment regardless of how complete
its stored breakdowns are:

- each row is matched to its question **by stable id** (position only as a legacy
  fallback) and re-attached its option list, key letter and `hasKey`;
- the marks themselves are never rewritten — `isCorrect`, `earnedPoints` and the
  student's answer stay exactly as the database wrote them;
- a paper whose stored rows carry no subpoint detail (graded before subpoints
  existed) is rendered from the freshly derived breakdown instead;
- an item that genuinely has no options (free text) is edited with a text field,
  and an item without a key warns that the score will not change — neither
  dead-ends in an empty dialog.

Re-applying `homework-subpoints.sql` is still worthwhile because it makes the
stored breakdowns self-contained for every other reader (reports, exports, direct
SQL), and it is followed by a check in `migration-groups-and-admin-editing.sql`
that reports a stale marker.

A submission is always reviewable once the row exists, even when the student left
every question blank: supplying a missing answer is an admin action like any
other, and the same RPC handles it (`previous_answer` is recorded as blank).

### Which submissions can be edited

Only `public.submissions` rows — the unified homework entries the students answer
through `/homework`. Legacy **lesson** homework submissions (`homework_submissions`,
the model-answer flow in the "Lesson gating" tab) remain read-only: the admin sees
the student's answers next to the key, and corrects the key or regrades with
`regrade_lesson_homework(uuid)` instead. There is deliberately no second,
weaker editing path for them.

## Regrading

Administrators use `regrade_assignment(uuid)` or `regrade_lesson_homework(uuid)`. The UI calls one set-based RPC rather than one write per student.

## Apply and test

```text
schema.sql
homework-grading.sql
migration-features.sql
homework-subpoints.sql
bulk-messaging.sql
```

Then run `npm test` locally — it covers the JS marker, the security invariants, the mounted UI in Arabic and English, and (when `embedded-postgres` is installed) the migrations and RPCs against a live PostgreSQL. See `docs/OPERATIONS.md` for the live homework/RLS checks.
