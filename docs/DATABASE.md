# Database reference

## Migration order

Apply in Supabase SQL Editor:

1. `schema.sql` — tables, indexes, signup trigger, RLS, redacted views, private storage.
2. `homework-grading.sql` — grading helpers/RPCs and reporting view.
3. `bulk-messaging.sql` — progress-report RPCs.
4. `migration-features.sql` — multi-group homework, admin student management RPCs, attendance cancellation, paginated student listing, signup group validation.
5. `homework-subpoints.sql` — nested MCQ subpoints, subpoint-aware marking, admin answer editing with an append-only audit trail.
6. `migration-groups-and-admin-editing.sql` — anon-readable `list_registration_groups()` for the signup form, strict grade/group validation on every profile write, corrected `groups.name -> profiles.group_name` sync, re-asserted grants for the admin RPCs, and a working `admin_set_student_password` (pgcrypto on the function `search_path`).
7. `migration-admin-create-student.sql` — `admin_create_student()`, the admin-only RPC behind the dashboard's **Add Student** form: it writes the `auth.users` row (bcrypt password, e-mail already confirmed) and its `auth.identities` record, then lets the existing signup trigger create the profile, so admin-created and self-registered students follow the same validated path.

The scripts use `IF NOT EXISTS`, `CREATE OR REPLACE`, and policy/trigger recreation where possible, so they are safe to run more than once. Back up production before any migration and test on staging first.

### Re-running the scripts

`ALTER TABLE ... ALTER COLUMN ... TYPE` is the one statement Postgres refuses to make idempotent — it fails with

```text
ERROR:  cannot alter type of a column used by a view or rule
DETAIL: rule _RETURN on view homework_catalog depends on column "score"
```

whenever a view already selects the column. `schema.sql` therefore never retypes a column directly: it calls `public.retype_column('<table>', '<column>', '<type>')`, which

1. does nothing when the column already has the requested type, and
2. otherwise drops every dependent view (including views stacked on top of them), changes the type, and rebuilds the views with their original `WITH (...)` options and privileges.

`homework-grading.sql` uses the same helper, so run `schema.sql` before it. If you ever need to widen a column by hand in the SQL Editor, use the helper instead of a bare `ALTER`:

```sql
SELECT public.retype_column('public.submissions', 'score', 'NUMERIC(8,2)');
```

## Entity relationships

```text
auth.users 1──1 profiles
profiles   ──< grades >── quizzes
profiles   ──< submissions >── assignments
profiles   ──< homework_submissions >── lessons
profiles   ──< attendance
profiles   ──< whatsapp_logs
profiles   >──0..1 groups
profiles   ──< content.created_by / grading audit fields
```

Deleting an Auth user cascades to the profile and dependent academic rows. Deleting lessons/assignments/quizzes cascades to their submissions/grades. Teacher audit references generally use `ON DELETE SET NULL`.

## Tables

### `profiles`

Application identity, one row per `auth.users` record.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK, FK `auth.users(id)`, cascade delete |
| `full_name` | text | Required, 2–120 chars for new/updated rows |
| `email` | text | Copied from Auth and student-protected |
| `phone` | text | Unique, optional, 10–15 digits for new/updated rows |
| `parent_phone` | text | Optional |
| `year_id` | text | Required, default `5`, admin-managed after signup |
| `group_name` | text | Compatibility/display value, admin-managed |
| `group_id` | UUID | FK `groups(id)`, set null on group deletion |
| `governorate` | text | Optional |
| `is_active` | boolean | Required, default true, admin-managed |
| `role` | text | `student` or `admin`; default student |
| `created_at` | timestamptz | Default now |

Indexes: role, year, group name, and partial `(year_id, group_name)` for students. `handle_new_auth_user()` creates rows atomically after signup. The escalation guard prevents a student changing role, activation, year, group, or email.

### `groups`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `name` | text | Required, unique |
| `year_id` | text | Optional grade association |
| `description` | text | Optional |
| `created_at` | timestamptz | Default now |

A trigger keeps denormalized `profiles.group_name` synchronized on rename/deletion.

### `lessons`

Lesson metadata and protected teaching/grading content.

`id` UUID PK; `year_id`; `semester` (1/2); `branch`; `unit`; `title`; `duration`; `views`; `video_url` HTTPS; `is_free`; summary PDF name/URL; `description`; `quiz_json`; `model_answers`; `homework_questions`; homework PDF name/URL; `created_at`.

Students do not select this table. `lesson_catalog` redacts keys and protected URLs. Indexed by year.

### `past_exams`

`id` UUID PK; `year_id`; `title`; `governorate`; `year_num`; `semester`; `branch`; PDF name/size/URL; solution-video URL; `created_at`. Public read, admin write. Indexed by year.

### `videos`

Standalone video library: `id`, title, description, YouTube URL, year, unit, publication flag, sort order, creator FK, created/updated timestamps. Active students read published videos for their own year; admins manage all. Indexed by year/publication. `updated_at` is trigger-maintained.

### `quizzes`

Quiz definitions: `id`, title, description, year, branch, semester, date, positive `max_score`, creator FK, created timestamp. Students read their own-year definitions; admins write. Indexed by year.

### `grades`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `quiz_id` | UUID | FK quizzes, cascade |
| `student_id` | UUID | FK profiles, cascade |
| `score` | numeric | Required, non-negative |
| `notes` | text | Optional |
| `graded_by` | UUID | FK profile, set null |
| `created_at`, `updated_at` | timestamptz | Audit timestamps |

Unique `(quiz_id, student_id)`. Indexed by quiz, student, and `(student_id, created_at desc)`. Students read only their own grades; admins write.

### `assignments`

Unified homework definition: `id`, title, description, year, branch, due date, positive `max_score`, attachment URL, publication flag, creator FK, timestamps, JSON `questions`, `total_points`, group name, explanation-video URL/title.

`questions` is an array of `{id, question, options, answer/correctAnswer, points}` and is constrained to 256 KB. Students use `homework_catalog`; direct table reads are admin-only. Feed index: `(year_id, is_published, group_name, created_at desc)`.

### `submissions`

One row per assignment/student (unique pair): text content, private `file_url` object path, JSON answers, status (`submitted`, `graded`, `returned`), score, feedback, correct/incorrect/unanswered counts, total points, percentage, per-question breakdown, auto-grade flag, grader FK, grading/submission/update timestamps.

Key controls:

- JSON answers must be an object no larger than 64 KB.
- Text is limited to 20,000 characters.
- Student policies require identity, active status, publication, matching year/group.
- `guard_submission_grading()` clears authoritative fields on student insert and restores them on update.
- Graded attempts cannot be directly edited by students.
- Indexed for recent student and assignment reads.

### `homework_submissions`

Legacy lesson-level homework submissions: lesson/student FKs, answers, weighted score, question/count analytics, percentage, breakdown, auto-grade flag, timestamps, unique lesson/student. Student writes are RPC-only; own read is allowed. Indexed by student/lesson/recent time.

### `attendance`

One row per student/date: status (`present`, `absent`, `late`, `excused`), optional year/notes, recorder FK, created timestamp. Unique `(student_id, session_date)`. Indexed by date, student, and recent student date. Students read own rows; admins write.

### `whatsapp_logs`

Admin-only audit records: student FK, normalized phone, recipient name/type, message body, status (`sent`, `failed`, `pending`), error, sent/created timestamps. Indexed by sent time, student, and status. Apply a retention policy because this table contains personal data.

## Views

| View | Security model | Purpose |
| --- | --- | --- |
| `lesson_catalog` | Owner-executed, explicitly redacted | Public metadata; protected URLs only for eligible users/admins; keys removed for non-admins |
| `homework_catalog` | Owner-executed, explicit eligibility/redaction | Active student's year/group feed; explanation URL gated by own graded row |
| `student_analytics` | `security_invoker=true` | Per-student quiz/homework/attendance aggregates under caller RLS |
| `homework_marking_report` | `security_invoker=true` | Assignment correctness summary |

The owner-executed catalog views are intentional: direct base-table read policies are admin-only, and each sensitive output is explicitly redacted.

### `assignment_groups`

Many-to-many junction for multi-group homework assignment:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | PK |
| `assignment_id` | UUID | FK assignments, cascade |
| `group_id` | UUID | FK groups, cascade |
| `created_at` | timestamptz | Default now |

Unique `(assignment_id, group_id)`. When an assignment has entries in this table, only students in those groups can access it (in addition to the legacy `group_name` check). An empty table means the assignment is general (available to all students of the matching year).

### `submission_answer_edits`

Append-only audit trail written by `admin_update_submission_answer()` whenever an administrator changes a submitted answer.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `submission_id` | UUID | FK submissions, cascade |
| `assignment_id` | UUID | FK assignments, cascade |
| `student_id` | UUID | FK profiles, cascade |
| `question_id` | text | stable question id |
| `subpoint_id` | text | NULL when a plain question was edited |
| `previous_answer` | text | NULL when the item was unanswered |
| `new_answer` | text | canonical option letter where options exist |
| `score_before` / `score_after` | numeric(8,2) | the recalculated totals |
| `changed_by` | UUID | FK profiles, the acting admin |
| `created_at` | timestamptz | default now |

RLS is enabled with a single `SELECT` policy for administrators. There is deliberately **no** insert/update/delete policy — the `SECURITY DEFINER` RPC is the only writer — and a `BEFORE UPDATE OR DELETE` trigger raises even for a caller that bypasses RLS, so the history cannot be rewritten or erased. Indexed on `(submission_id, created_at DESC)` and `(student_id, created_at DESC)`.

## Important functions

- `is_admin()`, `is_active_student()` — non-recursive RLS helpers.
- `can_access_assignment(uuid)` — publication/activity/year/group authorization (supports multi-group via `assignment_groups`).
- `promote_to_admin(email)` — SQL-editor bootstrap or admin-only RPC.
- `strip_assessment_answers(jsonb)` — removes answer-key fields from a question **and from each of its nested subpoints**.
- `grade_assignment_submission(...)`, `grade_lesson_homework(...)` — authoritative markers.
- `regrade_assignment(uuid)`, `regrade_lesson_homework(uuid)` — admin batch operations.
- `ph_mark_answers(jsonb, jsonb)` — the shared marker; grades every nested subpoint independently and never double-counts a parent question.
- `ph_roman(int)` — lowercase roman numeral (1 → `i`), matching `romanNumeral()` in `src/lib/grading.js`.
- `ph_answer_node/_text`, `ph_subpoint_answer(...)` — read a student's answer from either the flat or the nested submission shape.
- `admin_update_submission_answer(uuid, text, text, text)` — admin-only edit of one submitted answer; re-grades and audits.
- `bulk_messaging_report(year)`, `student_progress_log(student)` — reporting RPCs.
- `touch_updated_at()`, `stamp_grader()` — audit triggers.
- `admin_create_student(text, text, text, text, text, text, uuid, text, boolean)` — admin-only creation of a student account: writes `auth.users` (bcrypt password, e-mail pre-confirmed) and `auth.identities`, lets the signup trigger create the profile, then applies `is_active`. Returns the profile row.
- `admin_update_student(...)` — securely updates student profile fields including email sync with auth.users.
- `admin_set_student_password(uuid, text)` — sets a new password for a student. Hashes with pgcrypto bcrypt (`crypt(..., gen_salt('bf', 10))`, `search_path` includes `extensions`) and writes only the hash to `auth.users.encrypted_password`.
- `admin_initiate_password_reset(uuid)` — returns email for client-side Supabase reset flow.
- `fetch_students_paginated(...)` — server-side paginated student listing with search/filter.
- `cancel_attendance(uuid, date)` — deletes an attendance record (admin-only).
- `bulk_update_student_group(uuid[], uuid)` — batch assign students to a group.
- `bulk_update_student_status(uuid[], boolean)` — batch activate/suspend students.
- `set_assignment_groups(uuid, uuid[])` — replace assignment's group assignments.
- `get_assignment_groups(uuid)` — retrieve group IDs for an assignment.

## Storage

Bucket `submissions` is private:

- Maximum object size: 10 MB.
- MIME allowlist: PDF, JPEG, PNG, WebP.
- Extension allowlist repeats the same formats and excludes SVG/HTML/scripts.
- Student object keys must begin `<auth.uid()>/`.
- Students read only their own prefix; admins can manage all objects.

The application stores the object path. A future download UI should call `createSignedUrl()` after authorization rather than make the bucket public.

## Data maintenance

- Back up with Supabase backups/`pg_dump` before schema changes.
- Add migrations idempotently and test on a staging project.
- Use `EXPLAIN (ANALYZE, BUFFERS)` for slow reporting queries.
- Review index usage before removing indexes.
- Periodically purge old `whatsapp_logs` according to the privacy policy.
- Never edit roles with browser code; use `promote_to_admin()` from SQL Editor for bootstrap.
