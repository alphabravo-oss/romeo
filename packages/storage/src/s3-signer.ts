export interface S3PresignInput {
  accessKeyId: string
  bucket: string
  contentType?: string
  endpoint: string
  expiresInSeconds: number
  key: string
  method: 'DELETE' | 'GET' | 'PUT'
  now?: Date
  query?: Record<string, string | undefined>
  region: string
  secretAccessKey: string
}

export interface S3PresignedRequest {
  expiresAt: string
  headers: Record<string, string>
  url: string
}

export async function createS3PresignedRequest(input: S3PresignInput): Promise<S3PresignedRequest> {
  const now = input.now ?? new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const endpoint = new URL(input.endpoint)
  const url = new URL(`${trimTrailingSlash(endpoint.toString())}/${encodePathSegment(input.bucket)}/${encodeS3Key(input.key)}`)
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`
  const signedHeaders = input.contentType ? 'content-type;host' : 'host'
  const headers = input.contentType ? { 'content-type': input.contentType } : {}
  const query = new Map<string, string>(signedQueryEntries(input.query))
  query.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  query.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD')
  query.set('X-Amz-Credential', `${input.accessKeyId}/${scope}`)
  query.set('X-Amz-Date', amzDate)
  query.set('X-Amz-Expires', String(input.expiresInSeconds))
  query.set('X-Amz-SignedHeaders', signedHeaders)
  const canonicalHeaders = input.contentType ? `content-type:${input.contentType}\nhost:${url.host}\n` : `host:${url.host}\n`
  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD'
  ].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')
  const signingKey = await s3SigningKey(input.secretAccessKey, dateStamp, input.region)
  query.set('X-Amz-Signature', toHex(await hmac(signingKey, stringToSign)))
  url.search = canonicalQuery(query)

  return {
    expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString(),
    headers,
    url: url.toString()
  }
}

function signedQueryEntries(query: Record<string, string | undefined> | undefined): Array<[string, string]> {
  if (query === undefined) return []
  return Object.entries(query)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => {
      if (key.toLowerCase().startsWith('x-amz-')) throw new Error('S3 presigned query cannot override signing parameters.')
      return [key, value]
    })
}

function canonicalQuery(query: Map<string, string>): string {
  return [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&')
}

async function s3SigningKey(secretAccessKey: string, dateStamp: string, region: string): Promise<Uint8Array> {
  const dateKey = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp)
  const regionKey = await hmac(dateKey, region)
  const serviceKey = await hmac(regionKey, 's3')
  return hmac(serviceKey, 'aws4_request')
}

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)))
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return toHex(new Uint8Array(digest))
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function encodeS3Key(key: string): string {
  return key.split('/').map(encodePathSegment).join('/')
}

function encodePathSegment(value: string): string {
  return encodeRfc3986(value)
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
