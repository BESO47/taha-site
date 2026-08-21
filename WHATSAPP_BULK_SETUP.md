# WhatsApp bulk messaging setup

The detailed HTTP API is in [`docs/API.md`](docs/API.md); operational deployment is in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Secure design

- The browser sends its current Supabase access token.
- The gateway verifies the token and active administrator profile.
- Provider/webhook/API-key secrets stay in the server secret manager.
- Payloads are size/field validated and rate limited.
- Campaigns are globally serialized, paced, retryable, pausable, and cancellable.
- Manual `wa.me` openings are not reported as confirmed delivery.

## Local dry run

Frontend `.env`:

```dotenv
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=PUBLIC_KEY
VITE_WHATSAPP_GATEWAY_URL=/api/whatsapp
```

Server `server/.env`:

```dotenv
NODE_ENV=development
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_ANON_KEY=PUBLIC_KEY
WA_ALLOWED_ORIGINS=http://localhost:5173
WA_PROVIDER=mock
```

Run:

```bash
npm ci
npm --prefix server ci
npm run gateway
npm run dev
```

Sign in as an admin and use **Dry run** before a campaign.

For a completely local gateway call without Supabase, explicitly set `WA_ALLOW_INSECURE_LOCAL=true`; it accepts only loopback requests and production startup rejects it.

## Production provider

Prefer:

- `WA_PROVIDER=cloud-api` with Meta server credentials; or
- `WA_PROVIDER=webhook` with an HTTPS trusted relay and server-side auth header.

The optional WhatsApp Web dependency is not bundled while its transitive Chromium extraction chain has a known unresolved advisory. Do not bypass the dependency audit merely to enable QR mode.

## Production requirements

- Persistent Node process (not short-lived serverless).
- HTTPS reverse proxy and same-origin `/api/whatsapp` where possible.
- Exact `WA_ALLOWED_ORIGINS`; no wildcard.
- Supabase URL/public key for admin-token verification and/or a 32+ character server API key.
- Real non-mock provider.
- Consent, opt-out, retention, and Meta policy compliance.
- Durable queue before multiple gateway replicas.

## Troubleshooting

| Error | Action |
| --- | --- |
| Startup says auth missing | Set Supabase URL/public key or server-only API key |
| 401 | Token expired/project mismatch; sign in again and verify gateway Supabase project |
| 403 | Profile must be active admin |
| 429 | Reduce polling/calls or carefully change server limit |
| Provider not ready | Verify provider credentials/start session |
| Browser CSP/CORS failure | Use same-origin proxy or add the exact gateway origin to both policies |
| Job lost after restart | Expected for memory queue; deploy a durable queue |

Never add `VITE_WHATSAPP_API_KEY` or `VITE_WHATSAPP_WEBHOOK_URL`; those values would be public browser code.
