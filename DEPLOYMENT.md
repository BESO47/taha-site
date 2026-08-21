# Deployment guide

The site is a Vite single-page application backed by Supabase. Vercel builds the frontend; Supabase provides authentication, PostgreSQL, Row Level Security, and file storage.

## Prerequisites

- A Supabase project
- A Vercel account connected to this Git repository
- Node.js 18 or newer for local builds

## 1. Configure Supabase

1. Open **Supabase Dashboard → SQL Editor → New query**.
2. Copy all of [`schema.sql`](./schema.sql), paste it into the query, and select **Run**. The script is idempotent, so it can also update an existing installation.
3. For the bulk WhatsApp messaging feature (latest quiz score / homework / attendance per student), also run [`bulk-messaging.sql`](./bulk-messaging.sql) once. It adds the `bulk_messaging_report` and `student_progress_log` RPCs; the UI falls back to assembling the same data client-side if the RPC is not deployed.
4. Run [`homework-grading.sql`](./homework-grading.sql) once. It adds the answer-key marking columns (`correct_count`, `incorrect_count`, `percentage`, `breakdown`, …) plus the `grade_assignment_submission` / `grade_lesson_homework` RPCs that mark submissions server-side, and the `assignments.explanation_video_url` column used by the gated homework explanation videos. See [`HOMEWORK_GRADING.md`](./HOMEWORK_GRADING.md). Until it is applied the app still works, marking answers in the browser instead.
5. In **Project Settings → API**, copy:
   - the project URL;
   - the public `anon` key (called the publishable key in newer Supabase projects).

Do not put the Supabase `service_role`/secret key in Vercel or any `VITE_` variable. Variables prefixed with `VITE_` are bundled into browser code.

### Create the first administrator

1. Deploy or run the site and register the administrator through the normal sign-up page. This creates both the Auth user and their `profiles` row.
2. In Supabase SQL Editor, run:

```sql
SELECT public.promote_to_admin('you@example.com');
```

3. Sign out and back in so the application reloads the updated profile.

If the database was initialized with an older `schema.sql` and promotion silently leaves the user as a student, run [`fix-admin-promotion.sql`](./fix-admin-promotion.sql) once, then run the promotion command again. The fix allows trusted SQL Editor operations with a NULL JWT while continuing to block student role escalation.

## 2. Deploy to Vercel

1. In Vercel, select **Add New → Project** and import this repository.
2. Vercel should detect **Vite**. [`vercel.json`](./vercel.json) supplies the build command, output directory, and SPA route fallback.
3. Add these variables under **Project Settings → Environment Variables**:

| Variable | Required | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL, such as `https://abc.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase public anon/publishable key |
| `VITE_WHATSAPP_WEBHOOK_URL` | No | Legacy direct relay endpoint; prefer the gateway below |
| `VITE_WHATSAPP_GATEWAY_URL` | No | Public URL of the bulk WhatsApp gateway, e.g. `https://wa.yourdomain.com/api/whatsapp` |
| `VITE_WHATSAPP_API_KEY` | No | Must match `WA_API_KEY` on the gateway |

### Bulk WhatsApp

Bulk messaging runs through the Node gateway in [`server/`](./server), which must be
hosted on a machine that stays awake (a small VPS with PM2 or Docker) — serverless
functions cannot keep a WhatsApp session alive. Full instructions:
[`WHATSAPP_BULK_SETUP.md`](./WHATSAPP_BULK_SETUP.md).

Locally, `npm run gateway` + `npm run dev` is all you need: Vite proxies
`/api/whatsapp` to `http://127.0.0.1:4000`.

Add the required variables to Production and Preview (and Development if desired), then deploy. Redeploy after changing any `VITE_` variable because Vite embeds values at build time.

## 3. Configure Supabase URLs

In **Supabase Dashboard → Authentication → URL Configuration**:

1. Set **Site URL** to the production Vercel URL, for example `https://example.vercel.app`.
2. Add the production URL and any required Vercel preview patterns to **Redirect URLs**.

The current email/password flow does not require an OAuth callback, but correct URLs are important for email confirmation and password recovery links.

## 4. Verify the deployment

Test the following after deployment:

- Open a nested route such as `/videos` directly and refresh it. The Vercel rewrite should return the app rather than a 404.
- Register and log in as a student.
- Confirm a student cannot open `/admin` or change their own role.
- Log in with the promoted account and open `/admin`.
- Create or edit a record and verify it appears after refreshing.
- Upload an assignment file and verify the `submissions` storage bucket accepts it.

## Local production check

```bash
npm ci
cp .env.example .env
# Fill in the two required Supabase values in .env
npm run build
npm run preview -- --host 0.0.0.0
```

Never commit `.env` or secret/service-role credentials.
