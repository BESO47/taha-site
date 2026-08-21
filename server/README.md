# Physics Hub WhatsApp gateway

Persistent, authenticated Express service for bulk WhatsApp delivery.

## Responsibilities

- Verify an active Supabase administrator or server-only API key.
- Enforce CORS, security headers, rate/body/message/recipient limits.
- Normalize phone numbers and sanitize metadata.
- Serialize/pause/resume/cancel jobs with pacing and retries.
- Adapt to Meta Cloud API, trusted webhook, mock, or optional WhatsApp Web.

## Run

```bash
npm ci
cp .env.example .env
npm test
npm start
```

Production refuses missing authentication, insecure-local mode, wildcard origins, mock provider, and weak API keys.

```text
src/
  index.js        process boot/shutdown
  app.js          middleware/controllers/routes
  auth.js         Supabase admin/API-key verification
  validation.js   HTTP payload validation
  config.js       environment parsing and production validation
  queue.js        serialized business queue
  phone.js        normalization/validation
  providers/      provider adapters
test/             HTTP/queue/phone integration tests
```

See [`../docs/API.md`](../docs/API.md), [`../docs/OPERATIONS.md`](../docs/OPERATIONS.md), and [`../WHATSAPP_BULK_SETUP.md`](../WHATSAPP_BULK_SETUP.md).
