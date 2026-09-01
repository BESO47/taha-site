# Installation, deployment, maintenance, and troubleshooting

## Fresh installation

### Requirements

- Node.js 22.12+
- npm 10+
- Git
- Supabase project
- Vercel/static host for the SPA
- Persistent Node host for automated messaging

### Database

1. Create a Supabase project.
2. In SQL Editor apply, in order:
   - `schema.sql`
   - `homework-grading.sql`
   - `bulk-messaging.sql`
   - `migration-features.sql`
   - `homework-subpoints.sql`
   - `migration-groups-and-admin-editing.sql`
3. In Authentication settings, decide whether email confirmation is required.
4. Set Site URL and allowed redirect URLs, including `/reset-password` on production.
5. Obtain project URL and public anon/publishable key.
6. Do **not** copy the service-role key into this frontend.

### Frontend

```bash
git clone <repository>
cd taha-site
npm ci
cp .env.example .env
```

Set:

```dotenv
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=PUBLIC_PUBLISHABLE_KEY
VITE_WHATSAPP_GATEWAY_URL=/api/whatsapp
```

Then:

```bash
npm test
npm run dev -- --host 0.0.0.0
```

Register the first account and promote it from SQL Editor:

```sql
SELECT public.promote_to_admin('teacher@example.com');
```

### Gateway

```bash
cd server
npm ci
cp .env.example .env
```

Minimum browser-auth setup:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
TRUST_PROXY=true
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_ANON_KEY=PUBLIC_PUBLISHABLE_KEY
WA_ALLOWED_ORIGINS=https://your-site.example
WA_PROVIDER=cloud-api
WA_CLOUD_TOKEN=...
WA_CLOUD_PHONE_NUMBER_ID=...
```

Use a host secret manager. Production startup fails if authentication is absent, insecure-local mode is enabled, wildcard CORS is configured, or provider is mock.

## Provider setup

### Meta Cloud API (recommended)

Set `WA_PROVIDER=cloud-api`, token, phone-number ID, API version, and optional approved template/language. Follow Meta's current consent/template/24-hour-window policies.

### Trusted webhook relay

Set `WA_PROVIDER=webhook`, an HTTPS relay URL, POST/PUT, and optional secret header/value. These values remain server-side. The relay receives normalized destination/message plus allowlisted metadata.

### Mock

Use only in development:

```bash
WA_ALLOW_INSECURE_LOCAL=true npm run mock
```

It validates and simulates sends without message-body logging.

### Optional WhatsApp Web

The adapter is lazy, but `whatsapp-web.js` is intentionally absent from dependencies because its Chromium extraction chain had an unresolved high-severity advisory at audit time. Prefer official Cloud API. Re-evaluate upstream advisories and compatibility before installing; do not override vulnerable transitive packages blindly.

## Production frontend deployment (Vercel)

1. Import the repository.
2. Select Node 22 and Vite.
3. Set the two Supabase browser variables.
4. Build with `npm run build`; output is `dist`.
5. Keep the supplied SPA rewrite and security headers from `vercel.json`.
6. Route same-origin `/api/whatsapp/*` to the gateway through your reverse proxy/platform. The supplied CSP permits the same-origin gateway. If using a separate gateway origin, explicitly add that exact HTTPS origin to CSP `connect-src` and `WA_ALLOWED_ORIGINS`.
7. Redeploy after changing `VITE_` values because Vite embeds them at build time.

The Node gateway cannot run as a short-lived serverless function because sessions/queues need a persistent process.

## Gateway deployment

Use systemd, Docker, or PM2 on a single persistent instance. Terminate TLS at a trusted reverse proxy. Forward the original client IP only when the proxy is trusted, then set `TRUST_PROXY=true` so rate limiting uses it correctly.

Example health check:

```bash
curl -fsS https://your-site.example/api/whatsapp/health
```

Do not expose port 4000 directly to the internet if the reverse proxy can isolate it.

## Post-deployment verification

Use a staging project first.

### Automated

```bash
npm ci
npm --prefix server ci
npm run check
npm run audit:dependencies
```

### Manual/live Supabase checks

Use separate student and admin accounts:

1. Register with email confirmation enabled; verify a profile row is created.
2. Verify password recovery redirects to `/reset-password` and updates the password.
3. As student, direct-select `lessons`/`assignments` should return no rows while catalogs work.
4. Verify catalog JSON contains no answer-key fields before submission.
5. Verify a student cannot update role, active flag, year, or group.
6. Verify suspended students cannot view protected URLs or submit.
7. Verify wrong MCQ answers produce a non-forgeable server score.
8. Attempt a direct submission with a fake score; verify the trigger clears it.
9. Verify a graded attempt cannot be resubmitted through the RPC.
10. Verify explanation URL is null before grade and available after grade.
11. Upload an allowed file and reject SVG/HTML/oversized files; confirm another student cannot read it.
12. Verify admin CRUD for every dashboard tab.
13. Run bulk-report RPC with enough data and inspect query performance.
14. Verify gateway health is public, status is 401 without auth, 403 for student, and works for admin.
15. Run a dry campaign before one real consenting recipient.
16. Check browser console for CSP violations and inspect production response headers.

No local test command can prove these live controls without project credentials; record the environment/date/account used for deployment acceptance.

## Maintenance

### Add a feature

1. Document the user action and authorization rule.
2. Put data access in `src/lib/api.js` or a new focused repository, not directly throughout UI.
3. Add RLS/function checks before relying on a route guard.
4. Add/alter tables idempotently in a migration; add indexes for actual filters/order.
5. Add unit/security tests and update API/database/manual docs.
6. Test student, suspended student, admin, and anonymous roles.

### Change the database

- Back up first.
- Never edit production only; commit the SQL migration.
- Use explicit constraints and foreign keys.
- Review SECURITY DEFINER functions for caller checks and fixed search paths.
- For catalog changes, verify sensitive columns remain redacted.
- Run `EXPLAIN (ANALYZE, BUFFERS)` on slow queries.

### Update dependencies

```bash
npm outdated
npm --prefix server outdated
npm update
npm --prefix server update
npm run check
npm run audit:dependencies
```

Review major-version release notes and lockfile diffs. Never use `npm audit fix --force` without regression testing.

### Debug

- Browser network response + Supabase error code identify RLS/schema problems.
- Gateway logs exclude full message bodies and mask phone numbers where possible.
- Enable `WA_DEBUG=true` only briefly; do not log tokens/provider secrets.
- Query Supabase logs for failed RPC/storage operations.
- Reproduce against staging with the same role.

### Backups and retention

- Enable Supabase backups/PITR appropriate to the service tier.
- Back up before destructive migrations.
- Define retention for WhatsApp message bodies and uploaded assignments.
- Gateway job history is memory-only; do not treat it as the sole audit record.

## Troubleshooting

| Symptom | Cause/fix |
| --- | --- |
| Frontend shows no database connection | Verify `VITE_SUPABASE_URL`/anon key and rebuild |
| Signup succeeds but no profile | Reapply `schema.sql`; inspect `on_auth_user_created`; old account may need an admin-created profile |
| Email-confirmation signup profile insert error | Use the trigger-based current schema; do not restore direct browser profile insertion |
| Catalog relation missing | Reapply current `schema.sql` and refresh PostgREST schema cache |
| Homework grading unavailable | Apply `homework-grading.sql`; configured mode intentionally refuses insecure client grading fallback |
| Subpoints not marked / admin answer edit missing | Apply `homework-subpoints.sql`; it upgrades `ph_mark_answers` and adds `admin_update_submission_answer` |
| Signup group selector empty for every grade | Apply `migration-groups-and-admin-editing.sql`; `public.groups` is invisible to the `anon` role, the form reads `list_registration_groups()` |
| "Unable to load groups" on the signup page | The RPC is missing or PostgREST has a stale schema cache: re-apply the migration, then reload the schema cache |
| Group renamed but students keep the old group name | Apply `migration-groups-and-admin-editing.sql`; the old `BEFORE UPDATE` trigger reverted every rename |
| Homework feed empty | Check publication, active profile, matching year/group, and `homework_catalog` grants |
| Explanation video remains locked | Submission must have status graded and non-null score for that user |
| Upload rejected | Check private bucket migration, MIME/extension, size ≤10 MB, and user-folder prefix |
| Admin page redirects | Refresh profile/sign out-in; verify role with SQL and that account is active |
| Gateway exits at startup | Read configuration error; configure Supabase/API key, non-mock production provider, and strict origins |
| Gateway 401 | Browser must send current Supabase JWT; server URL/anon key must match frontend project |
| Gateway 403 | Caller profile is not active admin |
| Gateway 429 | Reduce polling/request frequency or adjust limits carefully |
| Provider not ready | Start provider; check Cloud credentials/relay; optional Web session may need QR |
| CSP blocks gateway | Use same-origin proxy or add exact HTTPS gateway origin to CSP and CORS |
| Campaign disappears after restart | Expected for in-memory queue; adopt a durable queue |
| Vercel nested route 404 | Verify `vercel.json` SPA rewrite |
