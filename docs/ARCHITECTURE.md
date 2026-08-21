# Architecture

## Components

### React frontend

The Vite SPA owns presentation and user interactions. `AuthProvider` obtains the Supabase session, reads the caller's own `profiles` row, and exposes role/activity state. Route components are lazy loaded. `src/lib/supabase.js` handles lesson/exam content; `src/lib/api.js` is the domain repository for homework, student records, grades, attendance, analytics, and groups.

Frontend checks are convenience checks only. Every protected read/write is rechecked by RLS, a security-filtered view, a PostgreSQL RPC, or the Express gateway.

### Supabase

Supabase provides:

- Email/password authentication and password-recovery sessions.
- PostgreSQL tables and foreign keys.
- PostgREST APIs generated from tables/views/functions.
- RLS policies based on `auth.uid()`.
- `SECURITY DEFINER` grading functions with explicit caller checks.
- A private storage bucket for student submissions.

The browser uses only the public anon/publishable key plus the signed-in user's JWT.

### WhatsApp gateway

The persistent Express service validates an administrator in one of two ways:

1. Browser: verifies the Supabase bearer token, then checks the caller's own profile is an active administrator.
2. Trusted service: compares `x-api-key` to a server-only key using a timing-safe comparison.

It rate-limits requests, validates payload sizes and fields, serializes all campaigns, paces messages, retries transient errors, and delegates delivery to a provider adapter.

## Trust boundaries

```text
Untrusted browser input
  │
  ├─ Supabase JWT + anon key ─> PostgREST/RPC ─> RLS/function checks
  │
  └─ Supabase JWT ────────────> Gateway auth ─> validation ─> provider secrets
```

- `VITE_` configuration is public by design.
- Provider tokens and webhook/API-key credentials exist only in `server/.env` or the host secret manager.
- Answer keys remain in base tables. Student reads use redacted views.
- Admin pages can read base tables because `is_admin()` policies permit them.

## End-to-end feature traces

### Registration

1. Student submits name, email, validated phone numbers, year, governorate, and password.
2. React calls `supabase.auth.signUp()` with safe profile metadata.
3. Supabase Auth inserts `auth.users`.
4. `handle_new_auth_user()` atomically creates a `profiles` row with `role='student'` and `is_active=true`.
5. Email confirmation behavior follows the Supabase project configuration.
6. The frontend never inserts an elevated role.

This trigger-based design also works when sign-up returns no session pending email confirmation.

### Login and authorization

1. React calls Supabase password sign-in.
2. Supabase returns a session/JWT.
3. `AuthProvider` reads only `profiles.id = auth.uid()`.
4. React renders student/admin navigation.
5. Database RLS independently checks every operation.
6. Missing profiles and suspended profiles fail closed in protected routes.

### Lesson viewing

1. A route calls `lesson_catalog`, not `lessons`.
2. The view returns metadata but strips assessment answers.
3. Video/worksheet URLs are returned only to an active student in the matching year or an administrator.
4. The player accepts only HTTP(S) media and uses fixed YouTube/Drive embed formats.
5. Local progress is saved per user in browser storage; it is not authoritative academic data.

### Homework submission and automatic grading

1. `/homework` reads `homework_catalog`; PostgreSQL filters publication, activity, year, and group.
2. Question keys and locked explanation URLs are absent from the response.
3. Student answers are sent to `grade_assignment_submission()`.
4. The function checks identity, eligibility, JSON size, text length, private file path, and previous grade status.
5. `ph_mark_answers()` compares answers to keys in PostgreSQL.
6. A protected trigger permits authoritative fields only during the server-side grading transaction.
7. The result is stored in `submissions` and returned to the student.
8. Subsequent view reads expose the explanation URL because that student's row is graded.
9. A graded student attempt cannot be overwritten; administrators can regrade through `regrade_assignment()`.

Lesson-homework grading follows the same pattern through `grade_lesson_homework()` and direct student writes to `homework_submissions` are denied.

### Essay/file homework

1. Browser restricts files to PDF/JPEG/PNG/WebP and 10 MB.
2. Storage policies repeat extension, MIME, size, and `<auth.uid()>/...` ownership checks.
3. The private object path—not a public URL—is stored in `submissions.file_url`.
4. Direct student inserts/updates are reduced by the grading guard to answer/content/file fields only.
5. An admin records score and feedback.
6. Students can read only their own submission row/object.

### Admin CRUD

1. `/admin` requires `profile.role === 'admin'` in the UI.
2. CRUD calls use Supabase tables.
3. Table RLS calls `is_admin()` before allowing reads/writes.
4. Database triggers stamp graders and prevent student role/status/year/group escalation.
5. Empty database results remain empty; configured deployments no longer silently substitute demo records.

### Progress reporting and WhatsApp

1. Admin calls `bulk_messaging_report()` once; lateral/set-based SQL returns latest grade/homework/attendance plus aggregates without frontend N+1 requests.
2. React compiles a message preview and validates recipients.
3. Gateway requests include the current Supabase bearer token.
4. Gateway verifies Auth and active admin profile, validates payloads, and creates a job.
5. One global promise chain prevents campaigns from sending concurrently.
6. The provider confirms sends; the browser polls job status.
7. Admin-only `whatsapp_logs` records the outcome. Manual `wa.me` openings are logged as `pending`, not falsely as delivered.

## Error handling

- Data repositories throw configured-backend errors rather than hiding them with demo data.
- Gateway request errors use JSON with appropriate 4xx/5xx status codes.
- Internal gateway errors are logged server-side; 5xx responses return a generic message.
- Provider timeouts use `AbortController`.
- UI modules display loading/error states and preserve existing content where practical.

## Scalability

Current design is appropriate for one teacher/small deployment. For larger deployments:

- Replace the in-memory gateway queue with Redis/BullMQ or a managed queue.
- Store gateway job history durably and partition by tenant/admin.
- Add server-side pagination to admin tables.
- Move video delivery to signed streaming/DRM.
- Add a malware-scanning workflow for uploaded files.
- Add browser E2E tests against a disposable Supabase project.
