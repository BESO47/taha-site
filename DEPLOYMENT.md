# Deployment guide

The canonical installation/deployment/maintenance guide is [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Required order

1. Use Node.js 22.12+.
2. Apply `schema.sql`, `homework-grading.sql`, `migration-features.sql`, `homework-subpoints.sql`, `bulk-messaging.sql`, `migration-groups-and-admin-editing.sql`, then `migration-admin-create-student.sql` to Supabase, in that order.
   `migration-groups-and-admin-editing.sql` is mandatory: without it the signup page cannot read `public.groups` (RLS hides the table from anonymous visitors) and the grade/group selector stays empty.
   `migration-admin-create-student.sql` adds `admin_create_student()`; without it the dashboard's **Add Student** button reports a missing function.
3. Configure frontend with only `VITE_SUPABASE_URL`, public `VITE_SUPABASE_ANON_KEY`, and normally the relative gateway path.
4. Run `npm run check` and `npm run audit:dependencies`.
5. Deploy `dist/` from `npm run build`; retain `vercel.json` security headers and SPA rewrite.
6. Deploy `server/` on a persistent Node host with Supabase admin authentication, strict origins, and a real non-mock provider.
7. Reverse-proxy same-origin `/api/whatsapp` to the gateway.
8. Execute the live role-separated verification checklist in `docs/OPERATIONS.md`.

Never place a service-role key, provider token, webhook credential, or gateway shared API key in a `VITE_` variable. See [`SECURITY.md`](SECURITY.md).
