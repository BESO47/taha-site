# Administrator manual

## Access and permissions

An administrator is a normal registered Auth user whose profile is promoted from Supabase SQL Editor:

```sql
SELECT public.promote_to_admin('teacher@example.com');
```

Sign out/in after promotion. Never share the admin account. UI route protection is supplemented by database RLS and gateway token verification.

## Dashboard overview

Open `/admin`. Overview cards show student count, active count, attendance rate, and quiz average. A connection error should be investigated; the production app does not silently replace failed database reads with demo records.

## Students and groups

### Add a student (create an account for them)

Use this when a student cannot register themselves — you enter exactly what the signup form asks for and the account works immediately.

1. Open the **Students** tab and click **Add Student**.
2. Fill in: full name, email, password (8–72 characters) and its confirmation, student phone, guardian phone, grade, group (optional), governorate.
3. The group list only shows groups of the grade you picked; changing the grade clears the choice.
4. Leave **Active Account** ticked, or untick it to create the account already suspended.
5. Click **Create Account**. The account is created with the e-mail already confirmed, so the student can sign in straight away with no confirmation e-mail.
6. The confirmation screen shows the e-mail and password once, with a **Copy Login Details** button. Passwords are stored hashed and can never be shown again — if it is lost, use **Change Password** instead.

Your own admin session is not affected: creating a student never signs you out.

Common refusals, all shown in the dialog: the e-mail or student phone is already registered, the password is too short, or the chosen group belongs to a different grade.

If the button reports a missing database function, apply `migration-admin-create-student.sql` in the Supabase SQL editor and reload the PostgREST schema cache.

### Manage a student

- Search by name, email, or phone; filter by grade, group, or active/suspended status.
- Pagination loads 20 students at a time (server-side).
- Click a student name to open the **Student Details** modal with full profile, contact info, analytics, grades, attendance history, and homework results.
- Click the **Edit** icon to modify: name, email, phone, parent phone, grade, group, governorate, and active status. Email changes sync with Supabase Auth automatically.
- Click **Change Password** to set a new password for a student (8+ characters). The old password is never exposed or retrievable.
- Toggle active/suspended state with the status button.
- Assign a group from the inline dropdown.
- Use the WhatsApp button to send a student/guardian report.

Suspension blocks protected access and submissions. Student year/group are authorization fields and must be managed by an administrator.

### Bulk student actions

1. Use the checkbox next to each student (or "Select All") to select multiple students.
2. Choose a bulk action: Assign Group, Activate, or Suspend.
3. Confirm in the dialog.
4. The operation runs as a single set-based database RPC — not individual requests.

### Groups

1. Open **Manage groups**.
2. Enter name and year.
3. Save.
4. Assign students using their group selector.
5. Before deleting a group, verify no future homework depends on it. Deletion clears linked profile group fields.

## Homework

### Create/edit

1. Open **Homework**.
2. Enter title, description, year, optional branch/due date.
3. **Target Groups**: Check one or more groups to restrict the homework to those groups. If no groups are selected, the homework is available to all students of the selected grade (general assignment). Multi-group uses a normalized junction table (`assignment_groups`), not comma-separated names.
4. Add questions with choices, answer key, and positive point values.
5. **Subpoints**: Click **Add Subpoint** on any question to nest complete MCQs inside it. See *Nested subpoints* below.
6. Optionally add HTTPS attachment and explanation-video URLs.
7. Set publication status and save.

Published entries are visible only to active matching-year students who belong to one of the selected groups (or all students if no groups selected). The student response never includes answer-key fields.

### Nested subpoints

A question can be a container for sub-items, e.g. "Choose the correct answer for each of the following" followed by i, ii, iii.

- Every subpoint is a **complete MCQ**: its own text, four editable options (A/B/C/D), exactly one correct answer, and its own point value. There is no text-only subpoint, so nothing can end up unmarkable.
- Subpoints are numbered **i, ii, iii…** automatically from their position. The numeral is never typed or stored; delete subpoint ii and the rest re-number themselves everywhere (editor, student paper, grading screen, results).
- Use the up/down arrows to reorder. Reordering and deleting are safe because answers are keyed by each subpoint's stable id, not by its position.
- Deleting a subpoint asks for confirmation, since students may already have answered it.
- Once a question has subpoints its own options/answer/points fields are hidden: **the question's score is the sum of its subpoint points**, so nothing is double counted.
- Saving is blocked until every question and subpoint is complete; the offending item is named in the error.

### Grade and regrade

- Open submissions for an entry.
- Review student answers and correctness breakdown. For a question with subpoints, each subpoint is listed on its own row with its label, the student's answer, the correct answer, the mark and the points.
- For written work, enter a valid score and feedback and save.
- **Auto-grade all** invokes one database regrade RPC; it does not make an API request per student.
- If an answer key changes, regrade all affected attempts and notify students.

Explanation videos unlock only when status is graded and score is present.

### Change a student's submitted answer

From **Homework → submissions → view a submission**, every question and every subpoint has its own **Edit Answer** button.

1. Pick the new option and press **Continue**.
2. Confirm on the summary screen, which repeats the student, the homework, the question/subpoint and `previous → new`.
3. The database re-marks the whole paper, updates score/percentage/status and refreshes the screen. You never type a score.

Notes:

- Only one answer changes per action; every other answer is left untouched.
- The change is written to an append-only audit trail shown at the top of the submission, recording who changed what, from which value to which, the score before/after and the timestamp.
- Authorization is enforced by the database, not by hiding the button: a student who calls the RPC directly is rejected.
- If the homework has no answer key, the edit is saved but the submission is **not** promoted to "graded".

### Change a student's password

From **Students → open a student → Change Password**, set a new password directly.

- The current password is never requested, read or displayed — Supabase stores only a bcrypt hash in `auth.users`, and nothing can reverse it. There is no password column on `profiles` and no hash ever reaches the browser.
- Enter the new password twice (8–72 characters). The change goes through an admin-only RPC that re-checks `is_admin()` in the database.
- The student's own **Forgot password** recovery flow is unaffected and keeps working.
- If the dashboard shows `function crypt(text, text) does not exist` (or a "missing function" / type-cast hint), re-apply `migration-groups-and-admin-editing.sql` in the Supabase SQL editor and reload the PostgREST schema cache. The hasher lives in the `extensions` schema and must be on the function `search_path`.

### Legacy lesson homework

The legacy section manages `lessons.homework_questions/model_answers` and `homework_submissions`. Saving/regrading is protected by the same server-side RPC design.

## Quizzes and grades

1. Create a quiz with title, grade, branch, semester, date, and positive maximum score.
2. Select a quiz.
3. Enter each student's score/notes and save.
4. Delete only after confirming grade history may be cascaded.

Students see only their own grade records.

## Attendance

1. Select session date.
2. Filter students by grade, group, or search by name/phone.
3. Mark present, absent, late, or excused. Previously recorded statuses show as highlighted.
4. **Edit**: Click a different status button to change an existing record. Changed rows are highlighted yellow.
5. **Cancel Attendance**: Click the "Cancel" (✕) button next to a student to delete their attendance record for that date. A confirmation dialog prevents accidental deletion. The database record is actually deleted (not just hidden).
6. Save the batch.

The unique student/date key prevents duplicate session records. Only admins can write or delete attendance records.

## Lessons and past exams

### Lessons

Enter title, grade, branch, unit, duration, HTTPS video URL, description, and optional summary material. Use the edit/delete controls carefully; deleting a lesson cascades legacy lesson submissions.

### Past exams

Enter title, governorate, exam year, grade, branch, HTTPS paper URL, and optional solution video. Past exams are public by design.

## Standalone video library

Add a valid HTTPS YouTube URL, title, year, optional unit/description, publication flag, and sort order. Students read only published videos matching their year.

## Bulk WhatsApp messaging

1. Configure and start the server gateway; confirm the status in the dashboard.
2. Filter by year/group and select recipients.
3. Choose student or guardian destination.
4. Edit the template and preview variable replacement.
5. Review every message/number.
6. Prefer **dry run** for the first campaign.
7. Start dispatch. Use pause/resume/cancel as needed.
8. Review confirmed failures and audit logs.

The report comes from one set-based database RPC. Gateway campaigns are globally serial to avoid simultaneous sends. Manual `wa.me` mode only opens chats and is logged pending because browser opening does not prove delivery.

Comply with consent, opt-out, Meta template/window rules, privacy requirements, and reasonable pacing. Never send unsolicited bulk messages.

## Private submission files

The bucket is private and only permits PDF/JPEG/PNG/WebP up to 10 MB. Treat all uploads as untrusted. The current application validates type/size but does not run malware scanning; scan before opening if your workflow exposes downloads.

## Operational safety

- Use separate student and admin accounts for testing.
- Do not paste service-role/provider secrets into the SQL modal, browser env, or chat.
- Back up before deleting parent records.
- Review admin membership and WhatsApp logs regularly.
- Apply database scripts and dependency updates first on staging.
