const encoder = new TextEncoder()

export async function deriveWebhookSecret(signingKey: string, subscriptionId: string): Promise<string> {
  const digest = await hmacHex(signingKey, `subscription:${subscriptionId}`)
  return `whsec_${digest.slice(0, 48)}`
}

export async function signWebhookPayload(secret: string, timestamp: string, body: string): Promise<string> {
  return `v1=${await hmacHex(secret, `${timestamp}.${body}`)}`
}

async function hmacHex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(input))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
