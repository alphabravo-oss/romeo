import { isIP } from 'node:net'

import { ApiError } from '../errors'

const blockedHostSuffixes = ['.internal', '.local', '.localhost']

export function normalizeWebhookUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ApiError('invalid_webhook_url', 'Webhook URL must be a valid absolute HTTPS URL.', 400)
  }

  if (url.protocol !== 'https:') {
    throw new ApiError('invalid_webhook_url', 'Webhook URL must use HTTPS.', 400)
  }

  if (url.username || url.password || url.hash) {
    throw new ApiError('invalid_webhook_url', 'Webhook URL must not include credentials or fragments.', 400)
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  if (hostname === 'localhost' || blockedHostSuffixes.some((suffix) => hostname.endsWith(suffix)) || isIP(hostname) !== 0) {
    throw new ApiError('invalid_webhook_url', 'Webhook URL host is not allowed.', 400)
  }

  return url.toString()
}
