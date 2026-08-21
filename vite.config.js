import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The browser never talks to the WhatsApp gateway directly: it calls the
 * relative path `/api/whatsapp/*`, which Vite proxies to the Node service
 * (default http://localhost:4000). That keeps the API key off the client,
 * avoids CORS entirely and works inside sandboxed preview environments
 * where "localhost" means something different in the browser.
 *
 * Override the target with WHATSAPP_GATEWAY_URL when the gateway runs on
 * another host/port.
 */
const GATEWAY_TARGET = process.env.WHATSAPP_GATEWAY_URL || 'http://127.0.0.1:4000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['.e2b.app'],
    proxy: {
      '/api/whatsapp': {
        target: GATEWAY_TARGET,
        changeOrigin: true,
        ws: false,
        configure: (proxy) => {
          // Never let a stopped gateway crash the dev server: answer with a
          // JSON 503 the admin dashboard can render as "gateway offline".
          proxy.on('error', (err, req, res) => {
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
              res.writeHead(503, { 'Content-Type': 'application/json' })
            }
            if (res && typeof res.end === 'function') {
              res.end(
                JSON.stringify({
                  ok: false,
                  error:
                    'WhatsApp gateway is not running. Start it with `npm start` inside the `server/` folder ' +
                    '(see WHATSAPP_BULK_SETUP.md).',
                  detail: err?.message,
                })
              )
            }
          })
        },
      },
    },
  },
})
