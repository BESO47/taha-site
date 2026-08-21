/** Provider registry — picked with WA_PROVIDER. */
import { config } from '../config.js'
import * as whatsappWeb from './whatsappWeb.js'
import * as cloudApi from './cloudApi.js'
import * as webhook from './webhook.js'
import * as mock from './mock.js'

const providers = {
  'whatsapp-web': whatsappWeb,
  'cloud-api': cloudApi,
  webhook,
  mock,
}

export function getProvider() {
  const provider = providers[config.provider]
  if (!provider) {
    throw new Error(
      `Unknown WA_PROVIDER "${config.provider}". Valid values: ${Object.keys(providers).join(', ')}`
    )
  }
  return provider
}

export const providerNames = Object.keys(providers)
