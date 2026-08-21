# Database reference

## Migration order

Apply in Supabase SQL Editor:

1. `schema.sql` — tables, indexes, signup trigger, RLS, redacted views, private storage.
2. `homework-grading.sql` — grading helpers/RPCs and reporting view.
3. `bulk-messaging.sql` — progress-report RPCs.

The scripts use `IF NOT EXISTS`, `CREATE OR REPLACE`, and policy/trigger recreation where possible. Back up production before any migration and test on staging first.

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

## Important functions

- `is_admin()`, `is_active_student()` — non-recursive RLS helpers.
- `can_access_assignment(uuid)` — publication/activity/year/group authorization.
- `promote_to_admin(email)` — SQL-editor bootstrap or admin-only RPC.
- `strip_assessment_answers(jsonb)` — removes answer-key fields.
- `grade_assignment_submission(...)`, `grade_lesson_homework(...)` — authoritative markers.
- `regrade_assignment(uuid)`, `regrade_lesson_homework(uuid)` — admin batch operations.
- `bulk_messaging_report(year)`, `student_progress_log(student)` — reporting RPCs.
- `touch_updated_at()`, `stamp_grader()` — audit triggers.

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
