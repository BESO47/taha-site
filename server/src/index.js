import { createApp } from './app.js'
import { config, validateConfig } from './config.js'
import { log } from './logger.js'
import { getProvider } from './providers/index.js'

try {
  validateConfig()
} catch (error) {
  log.error(`Configuration error: ${error.message}`)
  process.exit(1)
}

const app = createApp()
const server = app.listen(config.port, config.host, async () => {
  log.info(`WhatsApp gateway listening on http://${config.host}:${config.port}`)
  log.info(`Provider: ${config.provider} · authentication required`)

  if (config.autoStart) {
    try {
      await getProvider().start()
    } catch (error) {
      log.warn(`Provider auto-start skipped: ${error.message}`)
    }
  }
})

let shuttingDown = false
const shutdown = async (signal) => {
  if (shuttingDown) return
  shuttingDown = true
  log.info(`${signal} received — shutting down`)
  const forceTimer = setTimeout(() => process.exit(1), 10_000)
  forceTimer.unref()

  try { await getProvider().stop() } catch (_) {}
  server.close((error) => {
    clearTimeout(forceTimer)
    process.exit(error ? 1 : 0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (error) => log.error('Unhandled rejection:', error))
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error)
  shutdown('uncaughtException')
})
