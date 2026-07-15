import { describe, expect, it } from 'vitest'

import { S3ObjectStore } from './s3-object-store'
import { createS3PresignedRequest } from './s3-signer'

const config = {
  endpoint: 'http://rustfs:9000',
  bucket: 'romeo',
  accessKeyId: 'romeo',
  secretAccessKey: 'romeo-local-secret',
  region: 'us-east-1'
}

describe('S3ObjectStore', () => {
  it('creates path-style S3-compatible presigned upload requests', async () => {
    const request = await createS3PresignedRequest({
      ...config,
      key: 'knowledge/source one.txt',
      method: 'PUT',
      contentType: 'text/plain',
      expiresInSeconds: 60,
      now: new Date('2026-06-27T12:00:00.000Z')
    })
    const url = new URL(request.url)

    expect(url.origin).toBe('http://rustfs:9000')
    expect(url.pathname).toBe('/romeo/knowledge/source%20one.txt')
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toContain('romeo/20260627/us-east-1/s3/aws4_request')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/)
    expect(request.headers).toEqual({ 'content-type': 'text/plain' })
    expect(request.expiresAt).toBe('2026-06-27T12:01:00.000Z')
  })

  it('signs bounded S3 API query parameters without allowing signing override', async () => {
    const request = await createS3PresignedRequest({
      ...config,
      key: '',
      method: 'GET',
      expiresInSeconds: 60,
      query: { 'list-type': '2', 'max-keys': '5', prefix: 'handbook/' },
      now: new Date('2026-06-27T12:00:00.000Z')
    })
    const url = new URL(request.url)

    expect(url.pathname).toBe('/romeo/')
    expect(url.searchParams.get('list-type')).toBe('2')
    expect(url.searchParams.get('max-keys')).toBe('5')
    expect(url.searchParams.get('prefix')).toBe('handbook/')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/)
    await expect(
      createS3PresignedRequest({
        ...config,
        key: '',
        method: 'GET',
        expiresInSeconds: 60,
        query: { 'X-Amz-Date': 'override' }
      })
    ).rejects.toThrow('S3 presigned query cannot override signing parameters.')
  })

  it('uploads through a presigned PUT request', async () => {
    const calls: Array<{ body: BodyInit | null | undefined; headers: HeadersInit | undefined; method: string | undefined; url: string }> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method, headers: init?.headers, body: init?.body })
      return new Response(null, { status: 200, headers: { etag: '"etag-from-rustfs"' } })
    }
    const store = new S3ObjectStore(config, fetchImpl)
    const stored = await store.putObject({
      key: 'knowledge/source.txt',
      body: new TextEncoder().encode('romeo storage'),
      contentType: 'text/plain'
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.url).toContain('/romeo/knowledge/source.txt?')
    expect(calls[0]!.headers).toEqual({ 'content-type': 'text/plain' })
    expect(stored.etag).toBe('etag-from-rustfs')
    expect(stored.sizeBytes).toBe('romeo storage'.length)
  })
})
