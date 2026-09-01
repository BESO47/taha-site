# Security policy

## Reporting a vulnerability

Do not open a public issue containing personal data, credentials, working exploits, or private URLs. Contact the repository owner privately with:

- Affected commit/version and environment.
- Reproduction steps and impact.
- Relevant request/response with tokens and student data removed.
- Suggested mitigation, if known.

Rotate any credential that may have been disclosed. Do not test against real student data without authorization.

## Security boundaries

- Supabase RLS/RPC/view logic is authoritative for application data.
- The Express gateway verifies active admin status or a server-only key.
- React route guards and disabled UI controls are not authorization.
- `VITE_` values are public and must never contain provider/service secrets.
- Private uploads are untrusted even when type restricted.

## Required production controls

- HTTPS everywhere and supplied CSP/HSTS headers.
- Current `schema.sql`, `homework-grading.sql`, `migration-features.sql`, `homework-subpoints.sql`, and `bulk-messaging.sql` applied.
- Email confirmation/rate limits/password policy configured in Supabase.
- Gateway auth configured; no wildcard origins or insecure-local/mock production mode.
- Secrets stored in hosting secret manager and rotated periodically.
- Separate least-privilege admin accounts; no shared credentials.
- Backups, privacy/retention policy, consent/opt-out for messaging.
- Dependency audit and tests before deployment.

## Homework answer keys and submitted answers

- `strip_assessment_answers()` removes every key spelling (`answer`, `correctAnswer`, `correct`, `correct_answer`, `key`, `modelAnswer`) from a question **and from each of its nested subpoints**. Students reading `homework_catalog` receive question text, options and points only.
- Adding admin answer editing did not widen what students receive: they still see only their own answer and their own result.
- `admin_update_submission_answer()` re-checks `is_admin()` in the database and is `REVOKE`d from `PUBLIC` and `anon`. Hiding the button is not the control.
- The audit table `submission_answer_edits` has a `SELECT`-only policy for admins and a trigger that rejects `UPDATE`/`DELETE`, so the history is append-only.

## Administrator password changes

- Admins set a new student password through `admin_set_student_password()`, which is admin-gated in the database and writes only a bcrypt hash (`crypt(new_password, gen_salt('bf'))`) into `auth.users`.
- The existing password is never retrieved, stored in plaintext, exposed as a hash to the frontend, or copied onto `profiles`. No service-role key is ever present in the browser.
- The student self-service recovery flow (`resetPasswordForEmail`) is independent and unaffected.

## Known residual risks

- Externally hosted video URLs are not DRM after an authorized user receives them.
- The gateway queue/history is process memory, not durable or multi-instance safe.
- Uploaded files are not malware-scanned by this repository.
- Browser manual WhatsApp mode cannot confirm delivery.
- Supabase live RLS/storage behavior requires deployment tests with real role-separated accounts.
- Optional WhatsApp Web automation is excluded from default dependencies pending a clean upstream advisory chain.

See `docs/OPERATIONS.md` for deployment checks and `AUDIT_REPORT.md` for the latest review scope.
