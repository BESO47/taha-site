# API reference

The application has two API surfaces:

1. Supabase-generated REST/RPC APIs used through `@supabase/supabase-js`.
2. The Express messaging API under `/api/whatsapp`.

## Authentication

### Supabase

The SDK sends the public anon/publishable key and, after login, `Authorization: Bearer <user JWT>`. RLS resolves `auth.uid()` from that JWT. A service-role key must never be sent to the browser.

### Messaging gateway

Except for health, every endpoint requires an active administrator:

```http
Authorization: Bearer <supabase-access-token>
```

The gateway asks Supabase Auth to verify the token, then reads the caller's own profile under RLS and requires `role=admin` and `is_active=true`.

Trusted backend callers may instead send:

```http
x-api-key: <WA_API_KEY>
```

That key must remain server-side and contain at least 32 characters. Production refuses unauthenticated mode.

All responses are JSON. Errors use:

```json
{ "ok": false, "error": "Human-readable message" }
```

Common statuses: `400` invalid input, `401` missing/invalid authentication, `403` non-admin, `404` job/route missing, `413` body/message/recipient limit, `429` rate limit, `500` internal error, `503` auth/provider unavailable.

## Gateway endpoints

Base URL: `/api/whatsapp`. Request body limit: 10 MB by default (`WA_JSON_BODY_LIMIT`), sized so a full `WA_MAX_RECIPIENTS` bulk campaign with localized multi-byte messages is never rejected with 413. Default rate limit: 120 requests/minute/IP.

### `GET /health`

Public liveness endpoint. Does not include credentials, QR codes, recipient data, or provider URL.

```json
{
  "ok": true,
  "service": "physics-hub-whatsapp-gateway",
  "provider": "cloud-api",
  "providers": ["whatsapp-web", "cloud-api", "webhook", "mock"],
  "authentication": { "apiKey": false, "supabase": true, "insecureLocal": false },
  "uptimeSeconds": 3600
}
```

### `GET /status`

Admin auth required. Returns provider state and queue defaults. For WhatsApp Web it may include the QR data URL; treat this response as sensitive.

### `POST /session/start`

Admin auth required. Starts/initializes the selected provider. Empty body.

### `POST /session/stop`

Admin auth required.

```json
{ "logout": false }
```

For WhatsApp Web, `logout:true` invalidates the linked session; `false` stops the process but preserves local auth.

### `POST /check`

Admin auth required. Validates and, where supported, checks a WhatsApp number.

```json
{ "phone": "01012345678" }
```

```json
{ "ok": true, "valid": true, "normalized": "201012345678", "chatId": "201012345678@c.us" }
```

### `POST /send`

Admin auth required. Sends one message. Message maximum: 4,096 characters.

```json
{
  "phone": "01012345678",
  "message": "Your Physics Hub report...",
  "meta": {
    "studentId": "uuid",
    "studentName": "Student Name",
    "groupName": "Group A",
    "recipientType": "student"
  }
}
```

Only allowlisted metadata fields are forwarded. Metadata cannot override destination/message fields.

### `POST /bulk`

Admin auth required. Creates an asynchronous, globally serialized job. Returns `202`.

```json
{
  "messages": [
    { "phone": "01012345678", "message": "Hello", "meta": { "studentName": "Ahmed" } }
  ],
  "delayMs": 4000,
  "jitterMs": 2000,
  "batchSize": 25,
  "batchPauseMs": 60000,
  "maxRetries": 2,
  "dryRun": false
}
```

Limits: recipients 1–configured maximum; delay/jitter up to 600,000 ms; batch 1–1,000; pause up to 3,600,000 ms; retries 0–10. At most the configured number of unfinished jobs can be queued.

Response excerpt:

```json
{
  "ok": true,
  "job": {
    "id": "uuid",
    "status": "queued",
    "total": 1,
    "processed": 0,
    "sent": 0,
    "failed": 0,
    "results": []
  }
}
```

### `GET /jobs`

Admin auth required. Returns summaries newest first; per-recipient results are omitted.

### `GET /jobs/:id`

Admin auth required. Returns complete progress/results for one in-memory job. `404` if absent/pruned.

### `POST /jobs/:id/pause`
### `POST /jobs/:id/resume`
### `POST /jobs/:id/cancel`

Admin auth required. Controls queued/running jobs. Cancellation waits for an in-flight provider call to finish.

## Supabase views and table operations

The frontend invokes these through the SDK rather than handwritten HTTP.

| Resource | Operation | Access |
| --- | --- | --- |
| `lesson_catalog` | select | Public metadata; conditional protected fields |
| `homework_catalog` | select | Active student year/group or admin |
| `past_exams` | select | Public |
| `profiles` | select/update own fields | Own row; admins all |
| `groups` | select | Active authenticated/admin |
| content/academic base tables | CRUD | Admin, except own student records described in RLS |
| `student_analytics` | select | Caller RLS |
| private storage `submissions` | upload/read | Own prefix; admin all |

Filters are PostgREST filters, for example:

```js
supabase.from('lesson_catalog').select('*').eq('year_id', '5')
```

## RPC endpoints

### `grade_assignment_submission`

Authenticated. Students submit only for themselves; admins may pass a student ID. Checks access, payload limits, private file path, and duplicate graded attempt.

Parameters:

```json
{
  "p_assignment_id": "uuid",
  "p_answers": { "q1": "A", "q2": "B" },
  "p_content": null,
  "p_file_url": "<student-uuid>/<object>.pdf",
  "p_student_id": null
}
```

Returns totals, correct/incorrect/unanswered counts, score, total points, percentage, and breakdown. Errors include unauthenticated, inaccessible/unpublished homework, malformed/oversized answers, invalid file path, and already graded.

`p_answers` accepts both shapes, which may be mixed inside one submission:

```jsonc
{
  "q1": "A",                                        // plain question
  "q2": { "answer": "", "subpoints": { "sp_a": "B", "sp_b": "C" } }  // nested subpoints
}
```

A question with subpoints is worth the sum of its subpoint points; its own `points` is ignored. Each subpoint is marked on its own, so the breakdown carries a `subpoints` array with the roman `label`, student answer, key, mark and points per item.

### `grade_lesson_homework`

Authenticated. Same marking result for legacy lesson homework. Active matching-year student or admin; one student submission attempt.

### `regrade_assignment`
### `regrade_lesson_homework`

Admin only. Recomputes all saved answer sheets from the current key in one database call.

### `admin_update_submission_answer`

**Admin only** — the database verifies `is_admin()`, and the function is revoked from `PUBLIC` and `anon`. This is the only path that can change an answer after a student has submitted.

```json
{
  "p_submission_id": "uuid",
  "p_question_id": "q2",
  "p_subpoint_id": "sp_b",
  "p_new_answer": "C"
}
```

`p_subpoint_id` is `null` when editing a plain question. Questions and subpoints are resolved **by stable id**; an unknown id raises instead of falling back to a position. The new answer is validated against the item's real options.

The function then re-marks the whole paper and returns the recalculated result:

```json
{
  "ok": true,
  "edit_id": "uuid",
  "previous_answer": "A",
  "new_answer": "C",
  "score": 5, "total_points": 5, "percentage": 100,
  "correct_count": 4, "incorrect_count": 0, "unanswered_count": 0,
  "status": "graded",
  "answers": {}, "breakdown": []
}
```

Every call appends a row to `submission_answer_edits` (student, submission, question, subpoint, previous/new answer, admin, score before/after, timestamp). That table is readable by admins only and rejects `UPDATE`/`DELETE`. A paper with no answer key keeps its current status rather than being promoted to `graded`.

Errors: not authenticated, not an administrator, submission/question/subpoint not found, answer not among the options, unchanged answer, oversized payload.

### `admin_set_student_password`

Admin only. Sets a new password for a student by writing a bcrypt hash to `auth.users.encrypted_password`. The existing password is never read or returned, and admin accounts cannot be changed through it. `admin_initiate_password_reset(uuid)` returns the target email so the client can start Supabase's own recovery flow.

### `bulk_messaging_report`

Authenticated under caller RLS; used by admin UI. Parameter `target_year text|null`. Returns one row per visible student with contact/group data, attendance aggregates/latest session, latest quiz, and latest homework. The frontend applies optional group filtering.

### `student_progress_log`

Authenticated under caller RLS. Parameter `target_student uuid`. Returns chronological quiz/homework/attendance history visible to the caller.

### `promote_to_admin`

Authenticated calls require an existing admin. Initial bootstrap is intended for Supabase SQL Editor:

```sql
SELECT public.promote_to_admin('teacher@example.com');
```

Do not expose a generic promotion button to students.

## Provider behavior

- `cloud-api`: official Meta API; free-form messages are subject to Meta's 24-hour window unless a configured template is used.
- `webhook`: server-side relay with optional secret header; provider URL is never returned.
- `mock`: dry development provider; production startup refuses it.
- `whatsapp-web`: optional lazy provider; see operations/security notes before installing its external package.
