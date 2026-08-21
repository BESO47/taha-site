# Physics Hub — WhatsApp gateway

Node service that owns the WhatsApp session and the bulk dispatch queue for the
admin dashboard.

```bash
npm install                 # add PUPPETEER_SKIP_DOWNLOAD=true if Chromium can't download
cp .env.example .env
npm start                   # http://localhost:4000/api/whatsapp/health
npm run mock                # dry-run provider: logs instead of sending
```

Providers (`WA_PROVIDER`): `whatsapp-web` (default, QR session), `cloud-api`
(Meta WhatsApp Cloud API), `webhook` (UltraMsg / Green API / Baileys / n8n relay),
`mock`.

Full instructions, production deployment, pacing/anti-ban settings, API reference
and troubleshooting: [`../WHATSAPP_BULK_SETUP.md`](../WHATSAPP_BULK_SETUP.md).

```
src/
  index.js              Express app + routes
  config.js             every env var in one place
  queue.js              sequential job queue (delay, jitter, retries, pause/resume/cancel)
  phone.js              phone normalization/validation (mirrors the front-end)
  logger.js
  providers/
    whatsappWeb.js      whatsapp-web.js session (QR, LocalAuth, auto-reconnect)
    cloudApi.js         Meta WhatsApp Cloud API
    webhook.js          generic HTTP relay
    mock.js             dry run
```
