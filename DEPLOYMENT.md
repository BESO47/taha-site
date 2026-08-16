# Deployment guide

The site is a Vite single-page application backed by Supabase. Vercel builds the frontend; Supabase provides authentication, PostgreSQL, Row Level Security, and file storage.

## Prerequisites

- A Supabase project
- A Vercel account connected to this Git repository
- Node.js 18 or newer for local builds

## 1. Configure Supabase

1. Open **Supabase Dashboard → SQL Editor → New query**.
2. Copy all of [`schema.sql`](./schema.sql), paste it into the query, and select **Run**. The script is idempotent, so it can also update an existing installation.
3. In **Project Settings → API**, copy:
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
| `VITE_WHATSAPP_WEBHOOK_URL` | No | HTTPS endpoint for automated WhatsApp delivery; omit to use `wa.me` links |

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
