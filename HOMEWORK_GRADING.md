# Homework marking, grading & the two student pages

Grades on Physics Hub are produced by **comparing each student answer with the
teacher's answer key**. Handing work in is never a grade by itself: an empty or
fully wrong paper scores 0 %, and every score is weighted by the points assigned
to each question.

## Student-facing structure: two separate pages

| Page | Route | Contains | Never contains |
|---|---|---|---|
| **Lessons** | `/lessons` (+ `/lessons/:id`) | Video lessons, summaries/materials, extra video resources, per-module progress | Homework assignments, answer sheets, homework links |
| **Homework** | `/homework` | Assignments, answer sheet + submission, automatic marking, status badges, gated explanation video | Course lesson content |

Both are reachable from the main menu (`Lessons` and `Homework` are separate
navigation entries; the Lessons entry also keeps the per-grade dropdown).
`/videos` now redirects to `/lessons`.

### Homework lifecycle & the unlock mechanic

```
Pending ──submit──▶ Submitted ──graded──▶ Graded ──▶ 🔓 Explanation video unlocked
             (MCQ homework is marked instantly, so it goes straight to Graded)
```

* Every card shows a status badge — **Pending**, **Submitted**, **Graded** — plus a
  **Video unlocked / Video locked** chip when the assignment has an explanation video.
* The explanation video URL lives on `assignments.explanation_video_url`
  (set it in Admin → Homework → entry editor).
* While the work is not graded the player is **not mounted at all**: the locked
  state renders a blurred placeholder, so the video URL never reaches the DOM
  (`src/components/HomeworkExplanationVideo.jsx`).
* Lesson progress on the Lessons page is tracked per student in
  `src/lib/progress.js` (localStorage: watched / completed, per module and overall).

## Where the logic lives

| Layer | File | Role |
|---|---|---|
| Marking engine (shared) | [`src/lib/grading.js`](./src/lib/grading.js) | Pure functions: normalise answers, compare with the key, produce the breakdown |
| Data layer | [`src/lib/api.js`](./src/lib/api.js) | `submitHomeworkSubmission`, `submitAssignmentAnswers`, `autoGradeAssignmentSubmissions`, `regradeLessonSubmissions` |
| Authoritative marker (SQL) | [`homework-grading.sql`](./homework-grading.sql) | `grade_assignment_submission()`, `grade_lesson_homework()`, `regrade_assignment()`, `regrade_lesson_homework()` |
| Student UI | `pages/HomeworkPage.jsx`, `HomeworkSubmitCard.jsx`, `HomeworkExplanationVideo.jsx`, `HomeworkStatusBadge.jsx` | Answer sheet, instant result, status badges, gated video |
| Lessons UI | `pages/LessonsPage.jsx`, `pages/LessonDetailPage.jsx`, `lib/progress.js` | Content delivery + progress (no homework) |
| Teacher UI | `components/admin/HomeworkTab.jsx` | Correct/incorrect columns, per-question review, “Auto-mark all papers” |

## The result object

`gradeSubmissionAgainstKey({ questions, modelAnswers, answers })` returns:

```js
{
  totalQuestions: 3,
  gradedQuestions: 3,      // questions that actually have a key
  answeredCount: 2,
  unansweredCount: 1,
  correctCount: 2,         // ← total correct
  incorrectCount: 1,       // ← total incorrect (unanswered counts as incorrect)
  earnedPoints: 15,
  totalPoints: 20,
  score: 15,
  percentage: 75,          // ← overall percentage score
  hasAnswerKey: true,
  breakdown: [             // ← per-question detail
    { questionId:'q1', number:1, question:'…', points:5, hasKey:true, answered:true,
      studentAnswer:'A', studentLetter:'A', correctAnswer:'A', isCorrect:true, earnedPoints:5 },
    …
  ]
}
```

The same shape is returned by the SQL functions (`correct_count`, `incorrect_count`,
`percentage`, `breakdown`), so the UI renders identical numbers whether the paper was
marked on the server or offline in the browser.

## Answer matching rules

* Options resolve to canonical letters: `"A"`, `"a"`, `"A) Ampere"`, `"Ampere"`,
  `2` (1-based index) and the Arabic letters `أ ب ج د` all map to the same option.
* Questions without options (short answer) are compared as normalised text:
  Arabic-Indic digits, harakat, tatweel, alef/ya/ta-marbuta variants, punctuation
  and repeated spaces are ignored — `"٥ أمبير" === "5 امبير"`.
* Per-question `points` (default 1) weight the final score.
* A question with **no key** is never auto-marked (it does not inflate the total),
  so essay-style homework still goes through manual grading.
* An unanswered question counts as incorrect.

## Data flow

**Lesson homework** (`homework_submissions`)

1. Student answers in *Homework* / *Lesson detail*.
2. `submitHomeworkSubmission()` calls the `grade_lesson_homework` RPC — the key
   (`lessons.homework_questions[].answer` + `lessons.model_answers`) never leaves
   the server. If the RPC is not deployed it falls back to the identical JS engine.
3. Stored: `score`, `total_points`, `correct_count`, `incorrect_count`,
   `unanswered_count`, `percentage`, `breakdown`.

**Homework entries** (`assignments` + `submissions`)

1. Student opens the answer sheet on the *Homework* page.
2. `submitAssignmentAnswers()` calls `grade_assignment_submission` (SECURITY
   DEFINER) which marks the paper and writes the score. Students cannot post their
   own score: the `submissions_guard_grading` trigger only lets the marker through.
3. The teacher sees correct/incorrect/% per student and can press
   **Auto-mark all papers** after editing the key (or run `SELECT public.regrade_assignment('<id>')`).

## Install the migration

Supabase Dashboard → SQL Editor → run [`homework-grading.sql`](./homework-grading.sql)
once (after `schema.sql`). It is idempotent. Until it is applied the app keeps
working: marking then happens client-side and only the base columns are written.

## Tests

```bash
npm run test:grading
```

12 checks cover weighted scoring, wrong/blank answers, letter/text/index answer
formats, Arabic normalisation, legacy `model_answers` maps and class averages.
