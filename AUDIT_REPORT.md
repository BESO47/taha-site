# Full-project audit report

**Audit date:** 2026-08-21  
**Scope:** React frontend, Supabase schema/RLS/RPC/storage, Express messaging gateway, dependencies, assets, configuration, tests, and documentation.

## Executive summary

The application had a sound basic Supabase/RLS direction, but several controls were undermined by direct table reads, permissive write policies, public storage, browser-embedded messaging credentials, and an optionally unauthenticated gateway. Those issues were fixed at the database/server boundaries. Dependency audits now report zero known vulnerabilities, the production bundle is route split, and gateway/security regressions have automated coverage.

A live Supabase instance and provider credentials were not available in the repository, so real hosted RLS/storage/CRUD/provider acceptance testing could not be executed. A detailed role-separated deployment checklist is provided in `docs/OPERATIONS.md`.

## Security issues found and fixed

| Finding | Risk | Fix |
| --- | --- | --- |
| Lesson/assignment `select('*')` exposed model answers/question keys | Critical assessment integrity | Admin-only base-table reads; `lesson_catalog`/`homework_catalog` redact key spellings |
| Locked explanation URL was returned before grade | High broken access control | Database view conditionally releases URL only for admin or own graded submission |
| Student homework feed trusted frontend year/group filters | High broken access control | `can_access_assignment()` and view/RPC enforce active profile, year, group, publication |
| Students could directly write lesson-homework scores | Critical grade forgery | Removed student INSERT/UPDATE policies; writes are RPC-only |
| Assignment INSERT trigger did not guard score; UPDATE left analytics forgeable | Critical grade forgery | Hardened BEFORE INSERT/UPDATE trigger clears/restores every authoritative grading field |
| Grading SECURITY DEFINER RPC allowed repeated overwrite and weak payload validation | High | Identity/access checks, 64 KB JSON limit, text/file checks, one graded attempt |
| Students could change grade used for content authorization | High privilege/access bypass | Profile guard preserves year/group/email/role/activity; student UI makes year read-only |
| Submission bucket/public URLs exposed student files to all authenticated users/public | Critical privacy | Private 10 MB MIME-limited bucket, own-prefix reads/uploads, extension allowlist, object paths |
| Any authenticated user could insert WhatsApp logs | Medium integrity/privacy | Admin-only log policies |
| Gateway/API key and direct webhook URL were bundled in browser variables | Critical secret exposure/abuse | Removed browser shared secret/direct webhook transport; browser sends Supabase JWT |
| Gateway allowed no auth and wildcard CORS by default | Critical unauthorized messaging | Fail-closed config, backend active-admin verification, strict production validation/origins |
| API key compared as normal strings | Low timing signal | SHA-256/timing-safe comparison |
| No request throttling/strict validation; 5 MB bodies | High abuse/DoS | 256 KB JSON cap, IP rate limit, recipient/message/options limits, metadata allowlist |
| Concurrent campaigns violated one-message-at-a-time guarantee | High provider abuse/ban risk | Global serialized job chain and bounded unfinished queue |
| Webhook metadata could override destination/message fields | High message manipulation | Allowlisted metadata placed before authoritative payload fields |
| Gateway/provider logs exposed full phone/message snippets | Medium personal-data leakage | Phone masking; mock logs only message length |
| Client anti-DevTools/context-menu code created false security, CPU use, and accessibility harm | Medium | Removed global blockers and 1-second detection interval; access is enforced server-side |
| Unsafe external media schemes could reach player | Medium content injection | HTTP(S)-only URL parsing and fixed YouTube/Drive IDs |
| Password recovery link was a dead `#` | Functional/auth gap | Complete recovery request/update route with non-enumerating response |
| Signup profile insert failed when email confirmation returned no session | High account consistency | Atomic Auth trigger creates a forced student profile from bounded metadata |
| Missing production security headers | Medium defense-in-depth | CSP, HSTS, nosniff, referrer, frame, opener and permissions policies |
| Root and server dependency audits reported 6 and 5 vulnerabilities | High supply chain | Updated Vite/router/PostCSS/etc.; removed vulnerable bundled WhatsApp Web chain; audits clean |

No `dangerouslySetInnerHTML`, `eval`, raw SQL string concatenation, committed private key, service-role key, or plaintext application secret was found.

## Performance optimizations

- Added route-level lazy loading for every page.
- Deferred the 153 KB admin implementation until `/admin` is opened.
- Dynamically import confetti only after successful actions.
- Removed the 1-second DevTools polling and duplicate global event blockers.
- Replaced configured-mode demo fallbacks that masked slow/failed backend reads.
- Replaced frontend per-student bulk-report N+1 reads with required set-based RPC.
- Replaced client per-submission regrade loops with one database RPC.
- Added compound indexes for recent submissions, grades, attendance, and assignment feed filters.
- Removed 198 vulnerable/heavy server packages from default installation.
- Production JS baseline: about **936.75 KB / 253.49 KB gzip** in one file before. Afterward the shared entry is **543.18 KB / 162.03 KB gzip**, translations are **48.50 KB / 16.43 KB gzip**, and the home route is **13.48 KB / 3.41 KB gzip**; the initial route is roughly 182 KB gzip while admin is deferred. CSS dropped from 60.86 KB to 56.38 KB.

## Cleanup and architecture improvements

- Removed tracked generated `dist/` artifacts (source assets remain in `public/`).
- Removed verified unused data helpers/functions and direct browser webhook dispatch code.
- Split gateway into `app.js` (HTTP/controller), `auth.js`, `validation.js`, `queue.js` business logic, and provider adapters.
- Centralized and validated gateway configuration.
- Reworked frontend content reads around secure database views while keeping admin CRUD on base tables.
- Added atomic profile creation and relational `profiles.group_id` FK with name synchronization.
- Added consistent password-recovery route and fail-closed missing-profile behavior.
- Corrected manual WhatsApp audit status to `pending` rather than claiming delivery.

## Database improvements

- Added/strengthened foreign key for profiles/groups.
- Added grading columns to fresh base schema so the security trigger is valid immediately.
- Added input/JSON/percentage/URL-related constraints where safe for existing installations (`NOT VALID` allows migration while enforcing new writes).
- Added private storage constraints/policies.
- Added redacted catalog views and explicit grants.
- Added security-invoker reporting views.
- Added authorization helper and hardened all grading/promotion guards.
- Added compound indexes matching actual sort/filter/report paths.

## Important files changed

- `schema.sql`, `homework-grading.sql`, `bulk-messaging.sql`
- `server/src/app.js`, `auth.js`, `validation.js`, `config.js`, `queue.js`, providers
- `src/lib/supabase.js`, `api.js`, `whatsapp.js`, `whatsappGateway.js`, grading/progress/data modules
- `src/App.jsx`, auth pages, homework/player/admin components
- `package*.json`, `server/package*.json`, `.env.example`, `vercel.json`
- `README.md`, `SECURITY.md`, `docs/*`

## Tests performed

Actually executed locally:

- `npm run test:grading`: **12/12 passed**.
- `npm run test:security`: static security regression assertions (rerun in final check).
- `npm --prefix server test`: **7/7 passed** in first pass, covering phone validation, security headers, auth rejection, payload validation, dry-run job lifecycle, malformed JSON.
- `npm run build`: successful Vite 8 production build.
- `node --check` on gateway and core JS modules: passed.
- `npm audit`: 0 vulnerabilities.
- `npm --prefix server audit`: 0 vulnerabilities.
- `git diff --check`: passed at audit checkpoint.
- Live local smoke test: Vite returned the SPA shell for `/`, login, recovery, lessons, homework, and admin routes; the same-origin gateway proxy returned health/status; a dry bulk job completed 1/1; invalid send input returned JSON `400`.

Not executed: live Supabase SQL migration, hosted RLS/storage CRUD, email delivery, real Cloud API/webhook/WhatsApp delivery, or browser automation. These need environment credentials/external accounts and are listed as deployment acceptance tests.

## Remaining issues and recommendations

1. Run all three migrations on staging and execute the role-separated acceptance checklist before production.
2. Add Playwright/Cypress E2E tests against an isolated Supabase test project.
3. Add signed-file download UI and malware scanning before teachers open uploads.
4. Move video delivery to expiring signed streams/DRM if content protection is commercially important.
5. Replace the in-memory queue with durable Redis/managed infrastructure before multi-instance deployment.
6. Add pagination for large admin datasets and formal data-retention deletion jobs.
7. Reassess WhatsApp Web only after its dependency audit is clean; prefer official Meta API.

## Scores after remediation

| Area | Score | Rationale |
| --- | ---: | --- |
| Security | 90/100 | Strong RLS/RPC/view/gateway boundaries and clean audits; live policy verification/DRM/malware scan remain |
| Performance | 86/100 | Major bundle/N+1/polling improvements; shared vendor chunk and unpaginated admin data can improve |
| Code quality | 86/100 | Gateway separated and dead code removed; some large legacy React/admin/data modules remain |
| Architecture | 89/100 | Clear frontend → safe API/RPC → service/database boundaries; frontend repository can be split further |
| Database quality | 91/100 | Constraints, FKs, indexes, RLS, redacted views and authoritative grading; staging migration validation remains |
| Maintainability | 89/100 | Tests, scripts, env contracts, and full documentation; no typed schema/TypeScript yet |
| Production readiness | 84/100 | Secure defaults/build/docs are ready; live Supabase/provider acceptance and durable queue are required |
| Documentation | 95/100 | Overview, architecture, folder map, DB/API references, user/admin/operations/security/troubleshooting included |

**Overall engineering assessment: 89/100**, conditional on applying and validating the database migrations in the target Supabase project.
