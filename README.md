# Physics Hub

Physics Hub is a bilingual Arabic/English learning platform for secondary-school physics. Students can register, watch lessons, download course material, submit homework, receive answer-key grading, review quiz/attendance history, and view gated homework explanation videos. Administrators manage students, groups, lessons, exams, videos, quizzes, grades, attendance, homework, and WhatsApp progress messages.

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, React Router 7, Vite 8, Tailwind CSS 3, Framer Motion, Lucide |
| Authentication | Supabase Auth (email/password and password recovery) |
| API/data | Supabase PostgREST, PostgreSQL RPC functions, Row Level Security |
| Database | Supabase PostgreSQL |
| Files | Private Supabase Storage `submissions` bucket |
| Messaging | Authenticated Express gateway; Meta Cloud API, server-side webhook, mock, or optional WhatsApp Web provider |
| Tests | Node assertions and Node's built-in test runner |
| Hosting | Vercel-compatible SPA plus a persistent Node host for the messaging gateway |

## How the system works

```text
Browser (React)
  ├─ Supabase SDK + user JWT ──> Auth / safe views / RLS / RPC ──> PostgreSQL
  └─ Bearer user JWT ──────────> Express WhatsApp API ──> serial queue ──> provider
```

The frontend never receives a database service-role key, WhatsApp token, webhook credential, or gateway shared secret. Supabase RLS and server-side RPCs enforce authorization. React route guards improve the user experience but are not a security boundary.

Sensitive learning data is read through two redacted views:

- `lesson_catalog` removes model answers and withholds lesson/video material from unauthorized accounts.
- `homework_catalog` removes answer keys, filters by year/group, and reveals an explanation-video URL only after that student's submission is graded.

See [Architecture](docs/ARCHITECTURE.md) for complete feature traces.

## Quick start

### Prerequisites

- Node.js 22.12 or newer
- npm 10 or newer
- A Supabase project

### Frontend

```bash
npm ci
cp .env.example .env
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev -- --host 0.0.0.0
```

In Supabase SQL Editor, apply the scripts in order:

1. `schema.sql`
2. `homework-grading.sql`
3. `bulk-messaging.sql`
4. `migration-features.sql`
5. `homework-subpoints.sql`
6. `migration-groups-and-admin-editing.sql`
7. `migration-admin-create-student.sql`

### Gateway

```bash
cd server
npm ci
cp .env.example .env
# Set SUPABASE_URL, SUPABASE_ANON_KEY, provider credentials, and allowed origins
npm start
```

The Vite development server proxies `/api/whatsapp` to port 4000.

## Verification commands

```bash
npm test                 # grading + security regressions + gateway API tests
npm run build            # production frontend build
npm run audit:dependencies
npm run check            # tests and build
```

Tests that require a live Supabase project are deployment checks and are not run by the local unit suite. Follow the verification checklist in [Operations](docs/OPERATIONS.md).

## Main routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | Public | Landing page and grade selection |
| `/register` | Public | Student account registration |
| `/login` | Public | Sign in |
| `/reset-password` | Public/recovery session | Request a reset link or set a new password |
| `/years/:yearId` | Public metadata | Grade-specific lesson/exam discovery |
| `/lessons`, `/lessons/:lessonId` | Public metadata; video requires eligible account | Course content |
| `/exams` | Public | Past papers and solutions |
| `/homework` | Active authenticated student | Homework feed, submission, grading, gated explanations |
| `/profile` | Active authenticated user with a profile | Personal progress and contact details |
| `/admin` | Administrator | All management features |

## Repository structure

```text
src/
  components/             shared UI
  components/admin/       administrator modules
  data/                   demo-only fallback content
  lib/
    auth.jsx              session/profile context
    supabase.js           client and lesson/exam repository
    api.js                domain data access and RPC calls
    grading.js            offline/admin grading logic
    whatsapp*.js          browser messaging client and manual fallback
  pages/                  route components (lazy loaded)
server/
  src/app.js              Express middleware and routes
  src/auth.js             API-key/Supabase administrator authentication
  src/validation.js       request validation
  src/queue.js            serialized in-memory dispatch queue
  src/providers/          provider adapters
  test/                   gateway integration tests
scripts/                  local regression tests
schema.sql                base schema, RLS, views, private storage
homework-grading.sql      authoritative grading RPCs
bulk-messaging.sql        set-based progress-report RPCs
migration-features.sql    multi-group homework, admin student RPCs
homework-subpoints.sql    nested MCQ subpoints, admin answer editing + audit
migration-groups-and-admin-editing.sql
                          signup group loading/validation, group-name sync fix
migration-admin-create-student.sql
                          admin-side student account creation (auth user + profile)
docs/                     architecture, API, database, manuals, operations
```

Generated `dist/` output and dependencies are intentionally not committed.

## Documentation

- [Architecture and end-to-end data flow](docs/ARCHITECTURE.md)
- [Database reference](docs/DATABASE.md)
- [API reference](docs/API.md)
- [Student/user manual](docs/USER_MANUAL.md)
- [Administrator manual](docs/ADMIN_MANUAL.md)
- [Installation, deployment, maintenance, and troubleshooting](docs/OPERATIONS.md)
- [Security policy and operating guidance](SECURITY.md)
- [Audit and final report](AUDIT_REPORT.md)

## Important limitations

- A client-side video player cannot provide DRM. Authorization prevents unauthorized URLs from being returned by the database, but externally hosted URLs can still be shared after a legitimate user receives them. Use signed streaming URLs/DRM for stronger protection.
- The default dispatch queue is in memory. A process restart loses queued/history state; use a durable queue for multi-instance or high-availability deployment.
- Files are type/size/extension restricted and private, but malware scanning requires an external scanner and is recommended before opening untrusted uploads.
- The optional `whatsapp-web.js` package is not bundled because its current Chromium extraction chain had an unresolved security advisory during this audit. Prefer Meta Cloud API or a trusted relay.
