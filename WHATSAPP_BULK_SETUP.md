# Bulk WhatsApp — full setup guide

Physics Hub sends bulk WhatsApp reports through a small **Node gateway** that lives
in [`server/`](./server). The gateway owns the WhatsApp session and the dispatch
queue; the admin dashboard only creates a job and polls its progress.

```
Admin dashboard (browser)
        │  POST /api/whatsapp/bulk        (relative URL — no CORS, no secrets in the browser)
        ▼
Vite dev server / your reverse proxy
        │
        ▼
WhatsApp gateway  (server/, Node 18+)
        │  provider = whatsapp-web | cloud-api | webhook | mock
        ▼
WhatsApp
```

---

## 0. What was broken before (audit summary)

| # | Problem found in the old code | Fix |
|---|---|---|
| 1 | `dispatchBulkWhatsAppQueue()` counted **every recipient as "sent"** when no webhook was configured — the teacher saw a green summary while nothing was delivered. | The dispatcher now refuses to run without a real transport, and a message is only counted as sent when the provider confirms it. |
| 2 | Bulk "sending" was really `window.open()` in a loop. Browsers block every popup after the first, and blocked windows were still counted as successes. | Blocked popups are detected and reported as failures; real sending now goes through the gateway. |
| 3 | Calling UltraMsg / Green API directly from the browser leaks the API token into the JS bundle and is blocked by CORS. | Credentials live only in `server/.env`; the browser talks to the gateway over a relative URL. |
| 4 | A campaign died when the admin closed the tab or the laptop slept. | The queue runs server-side as a job; the UI just polls `GET /jobs/:id`. |
| 5 | No retries, no number verification, fixed delay (easy ban pattern). | Automatic retries with backoff, `getNumberId()` verification, randomized jitter and a cool-down pause every N messages. |
| 6 | Pause/Resume/Cancel only affected the browser loop. | Real job controls on the gateway: `POST /jobs/:id/pause|resume|cancel`. |
| 7 | No way to rehearse a campaign. | `mock` provider + `dryRun` switch in the UI. |
| 8 | Phone normalization existed only in the browser, so the relay could receive invalid numbers. | Identical normalization/validation on both sides (`src/lib/whatsapp.js` ↔ `server/src/phone.js`). |

---

## 1. Prerequisites

* **Node.js 18+** (`node -v`)
* A phone with WhatsApp installed (for the QR based provider)
* On Linux servers: the Chromium dependencies listed in step 2.3

---

## 2. Run it locally (5 minutes)

### 2.1 Install the gateway

```bash
cd server
npm install          # downloads a bundled Chromium (~150 MB) for whatsapp-web.js
```

> **Corporate network / restricted sandbox?** If the Chromium download fails:
> ```bash
> PUPPETEER_SKIP_DOWNLOAD=true npm install
> sudo apt-get install -y chromium            # or: brew install chromium
> # then set WA_CHROMIUM_PATH=/usr/bin/chromium in server/.env
> ```

### 2.2 Configure

```bash
cp .env.example .env
```

Minimum for local use — the defaults already work:

```ini
PORT=4000
WA_PROVIDER=whatsapp-web
WA_ALLOWED_ORIGINS=http://localhost:5173
WA_API_KEY=                 # leave empty locally
```

### 2.3 Linux server packages (skip on macOS/Windows)

```bash
sudo apt-get update && sudo apt-get install -y \
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
  libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 \
  libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
  libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
  libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release \
  wget xdg-utils
```

### 2.4 Start both processes

Terminal 1 — the gateway:

```bash
npm run gateway          # from the repository root (= npm --prefix server start)
```

Terminal 2 — the site:

```bash
npm run dev
```

Vite proxies `/api/whatsapp/*` to `http://127.0.0.1:4000`, so **no CORS setup and no
API key in the browser** is needed in development.

### 2.5 Link the WhatsApp account (one time)

1. Open the admin dashboard → **Bulk WhatsApp** tab.
2. The connection card shows the session state. Press **Connect WhatsApp**.
3. A QR code appears (also printed in the gateway terminal).
4. On the phone: **WhatsApp → Settings → Linked devices → Link a device** → scan.
5. The card flips to **ready** — the session is saved in `server/.wwebjs_auth`, so
   restarts reconnect automatically. You only scan again after logging out.

### 2.6 Send a test campaign

1. Filter by grade / group and select a few students.
2. Edit the template (the `{{variables}}` are filled per student).
3. Tick **Dry run** first — the queue runs end-to-end and validates every number
   without sending anything.
4. Untick it and press **Send Bulk Messages**. The progress bar, per-recipient
   status and the pause / resume / cancel buttons are driven by the server job.

---

## 3. Choosing a provider

Set `WA_PROVIDER` in `server/.env`.

| Provider | When to use | Pros | Cons |
|---|---|---|---|
| `whatsapp-web` *(default)* | Teacher's normal number, no Meta account | Free, works with any number, rich text | Needs a persistent process + Chromium; unofficial |
| `cloud-api` | Official Meta WhatsApp Business API | Official, no browser, high throughput | Business verification; free-form text only inside the 24 h window, otherwise templates |
| `webhook` | You already pay for UltraMsg / Green API / a Baileys micro-service / n8n | No Chromium; provider handles the session | Third-party cost & dependency |
| `mock` | Testing | Logs instead of sending | — |

### 3.1 Meta Cloud API

```ini
WA_PROVIDER=cloud-api
WA_CLOUD_TOKEN=EAAG...                 # permanent system-user token
WA_CLOUD_PHONE_NUMBER_ID=123456789012345
WA_CLOUD_API_VERSION=v20.0
WA_CLOUD_TEMPLATE=                     # set a template name for messages outside 24h
WA_CLOUD_TEMPLATE_LANG=ar
```

### 3.2 Generic relay (UltraMsg, Green API, Baileys, n8n…)

```ini
WA_PROVIDER=webhook
WA_WEBHOOK_URL=https://api.ultramsg.com/instanceXXXX/messages/chat
WA_WEBHOOK_AUTH_HEADER=Authorization
WA_WEBHOOK_AUTH_VALUE=Bearer YOUR_TOKEN
```

The relay receives every common field name, so most services work without mapping:

```json
{
  "to": "201012345678", "phone": "201012345678", "formattedPhone": "+201012345678",
  "chatId": "201012345678@c.us", "message": "…", "body": "…", "text": "…",
  "studentId": "…", "studentName": "…", "recipientType": "student",
  "timestamp": "2026-08-21T10:00:00.000Z"
}
```

### 3.3 Using Baileys instead of whatsapp-web.js

Baileys speaks the WhatsApp protocol directly (no Chromium, lighter on RAM). Run it
as a tiny service that exposes `POST /send { phone, message }` and point the gateway
at it with `WA_PROVIDER=webhook` + `WA_WEBHOOK_URL=http://localhost:3001/send`.
All queueing, pacing, retries and logging stay in the gateway.

---

## 4. Anti-ban pacing (important)

WhatsApp bans numbers that behave like bots. Defaults in `server/.env`:

```ini
WA_DEFAULT_DELAY_MS=4000     # base gap between messages
WA_DEFAULT_JITTER_MS=2000    # + random 0–2 s so the rhythm is not robotic
WA_BATCH_SIZE=25             # after 25 messages…
WA_BATCH_PAUSE_MS=60000      # …cool down for 1 minute
WA_MAX_RETRIES=2             # retry transient failures
WA_VERIFY_NUMBERS=true       # skip numbers that are not on WhatsApp
```

Field-tested guidance:

* Warm a new number up: ~50 messages on day 1, then increase gradually.
* Prefer 4–8 s delays for lists over 100 recipients.
* Keep the text personalised (the `{{student_name}}` variable already does this) —
  identical messages to hundreds of numbers is the strongest ban signal.
* Never message people who did not opt in; parents/students registered on the
  platform have.

---

## 5. Production deployment (VPS)

The gateway must run on a machine that stays awake — **not** on Vercel
(serverless functions cannot keep a WhatsApp session alive).

```bash
# 1. Copy the repository to the server, then:
cd /opt/physics-hub/server
npm ci --omit=dev
cp .env.example .env && nano .env      # set WA_API_KEY + WA_ALLOWED_ORIGINS
```

`.env` for production:

```ini
PORT=4000
HOST=0.0.0.0
WA_API_KEY=<long-random-string>
WA_ALLOWED_ORIGINS=https://your-site.vercel.app
WA_PROVIDER=whatsapp-web
WA_HEADLESS=true
```

Keep it alive with **PM2** (or systemd):

```bash
npm i -g pm2
pm2 start src/index.js --name wa-gateway --cwd /opt/physics-hub/server
pm2 save && pm2 startup          # restart on reboot
pm2 logs wa-gateway              # first run: scan the QR shown here
```

Put it behind HTTPS (Nginx):

```nginx
server {
  server_name wa.yourdomain.com;
  location /api/whatsapp/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_read_timeout 300s;
  }
}
# then: sudo certbot --nginx -d wa.yourdomain.com
```

Finally point the front-end at it (Vercel → Project Settings → Environment Variables):

| Variable | Value |
|---|---|
| `VITE_WHATSAPP_GATEWAY_URL` | `https://wa.yourdomain.com/api/whatsapp` |
| `VITE_WHATSAPP_API_KEY` | the same string as `WA_API_KEY` |

Redeploy after changing `VITE_` variables (Vite inlines them at build time).

> **Security note:** anything in a `VITE_` variable is visible in the browser bundle.
> The API key only limits casual abuse — always keep `WA_ALLOWED_ORIGINS` tight, and
> put the gateway behind your own auth/VPN if it is exposed to the internet.

### Docker (optional)

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y chromium ca-certificates fonts-liberation \
    libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2 && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true WA_CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server .
VOLUME ["/app/.wwebjs_auth"]      # persist the session!
EXPOSE 4000
CMD ["node", "src/index.js"]
```

---

## 6. API reference

All routes are prefixed with `/api/whatsapp`. Send `x-api-key: <WA_API_KEY>` when a
key is configured.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service + provider info (no auth) |
| `GET` | `/status` | Session state, QR image (data URL), pacing defaults |
| `POST` | `/session/start` | Start / reconnect the session |
| `POST` | `/session/stop` | `{ "logout": true }` also unlinks the device |
| `POST` | `/check` | `{ "phone": "01012345678" }` → is it on WhatsApp? |
| `POST` | `/send` | `{ "phone", "message" }` — single message |
| `POST` | `/bulk` | `{ "messages":[{phone,message,meta}], "delayMs", "jitterMs", "dryRun" }` → `202 { job }` |
| `GET` | `/jobs` | Recent jobs (summaries) |
| `GET` | `/jobs/:id` | Full job incl. per-recipient results |
| `POST` | `/jobs/:id/pause` · `/resume` · `/cancel` | Live queue control |

Smoke test from the command line:

```bash
curl localhost:4000/api/whatsapp/health
curl -X POST localhost:4000/api/whatsapp/send \
  -H 'Content-Type: application/json' \
  -d '{"phone":"01012345678","message":"Test from Physics Hub ⚡"}'
```

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Dashboard says *“Cannot reach the WhatsApp gateway”* | Gateway not running → `npm run gateway`. In production check `VITE_WHATSAPP_GATEWAY_URL`. |
| `503 … gateway is not running` from `/api/whatsapp/*` | The Vite proxy could not reach port 4000. Start the gateway or set `WHATSAPP_GATEWAY_URL`. |
| QR never appears | `WA_AUTO_START=false`? Press **Connect WhatsApp**. Check the logs for a Chromium error. |
| `Failed to launch the browser process` | Missing Chromium libs (step 2.3) or wrong `WA_CHROMIUM_PATH`. |
| Session drops every few hours | The phone must stay online at least occasionally; keep the process running (PM2) and the `.wwebjs_auth` folder persistent. |
| `+20… is not registered on WhatsApp` | Correct the number in the student profile, or set `WA_VERIFY_NUMBERS=false` to attempt anyway. |
| Job status `failed` immediately | Session not ready — the gateway refuses to fake successes. Scan the QR first. |
| Messages send but nobody replies / number banned | Increase `WA_DEFAULT_DELAY_MS`, lower `WA_BATCH_SIZE`, personalise the template. |
| `401 Invalid or missing API key` | `VITE_WHATSAPP_API_KEY` (front-end) must equal `WA_API_KEY` (gateway); redeploy the front-end after changing it. |
| Popups blocked in manual mode | Manual mode is the fallback when no gateway is detected — start the gateway for automatic sending. |

Logs: `pm2 logs wa-gateway`, or the terminal running `npm run gateway`.
Every dispatch is also written to the `whatsapp_logs` table (History button in the UI).
