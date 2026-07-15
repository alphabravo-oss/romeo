import { describe, expect, it, vi } from 'vitest'

import { S3HttpConnectorReader } from './s3-data-connector-reader'
import { EnvironmentSecretResolver } from './secret-resolver'

describe('S3HttpConnectorReader', () => {
  it('lists and reads S3 connector objects with presigned requests', async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = []
    const objectBody = 'Romeo S3 connector imports bounded text objects.'
    const objectBytes = new TextEncoder().encode(objectBody)
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, ...(init === undefined ? {} : { init }) })
      if (url.includes('list-type=2')) {
        return new Response(
          [
            '<ListBucketResult>',
            '<IsTruncated>false</IsTruncated>',
            `<Contents><Key>handbook/policies/access.md</Key><Size>${objectBytes.byteLength}</Size></Contents>`,
            '</ListBucketResult>'
          ].join(''),
          { status: 200, headers: { 'content-type': 'application/xml' } }
        )
      }
      return new Response(objectBody, {
        status: 200,
        headers: { 'content-type': 'text/markdown' }
      })
    })
    const reader = new S3HttpConnectorReader({
      accessKeyId: 'connector-access-key',
      endpoint: 'https://s3.example.com',
      fetchImpl,
      secretAccessKey: 'connector-secret-key'
    })

    const objects = await reader.listObjects({ bucket: 'romeo-docs', prefix: 'handbook/', region: 'us-east-1', maxKeys: 5 })
    const object = await reader.getObject({ bucket: 'romeo-docs', key: objects[0]!.key, region: 'us-east-1' })

    expect(objects).toEqual([{ key: 'handbook/policies/access.md', sizeBytes: objectBytes.byteLength }])
    expect(new TextDecoder().decode(object?.body)).toContain('bounded text objects')
    expect(object?.contentType).toBe('text/markdown')
    expect(calls).toHaveLength(2)
    expect(new URL(calls[0]!.url).pathname).toBe('/romeo-docs/')
    expect(new URL(calls[0]!.url).searchParams.get('prefix')).toBe('handbook/')
    expect(new URL(calls[0]!.url).searchParams.get('max-keys')).toBe('5')
    expect(new URL(calls[1]!.url).pathname).toBe('/romeo-docs/handbook/policies/access.md')
    expect(JSON.stringify(calls)).not.toContain('connector-secret-key')
  })

  it('rejects connector secret refs in the built-in deployment-credential reader', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const reader = new S3HttpConnectorReader({
      accessKeyId: 'connector-access-key',
      endpoint: 'https://s3.example.com',
      fetchImpl,
      secretAccessKey: 'connector-secret-key'
    })

    await expect(
      reader.listObjects({
        bucket: 'romeo-docs',
        prefix: 'handbook/',
        region: 'us-east-1',
        maxKeys: 5,
        secretRef: 'env://S3_CONNECTOR_TOKEN'
      })
    ).rejects.toMatchObject({ code: 'connector_s3_secret_ref_unsupported' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('resolves connector-specific S3 credentials from env secret refs', async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, ...(init === undefined ? {} : { init }) })
      if (url.includes('list-type=2')) {
        return new Response(
          [
            '<ListBucketResult>',
            '<IsTruncated>false</IsTruncated>',
            '<Contents><Key>handbook/private.md</Key><Size>15</Size></Contents>',
            '</ListBucketResult>'
          ].join(''),
          { status: 200, headers: { 'content-type': 'application/xml' } }
        )
      }
      return new Response('Romeo private S3 notes.', {
        status: 200,
        headers: { 'content-type': 'text/markdown' }
      })
    })
    const reader = new S3HttpConnectorReader({
      accessKeyId: '',
      endpoint: 'https://s3.example.com',
      fetchImpl,
      secretAccessKey: '',
      secretResolver: new EnvironmentSecretResolver({
        S3_CONNECTOR_CREDENTIALS: JSON.stringify({
          accessKeyId: 'connector-specific-key',
          secretAccessKey: 'connector-specific-secret'
        })
      })
    })

    const objects = await reader.listObjects({
      bucket: 'romeo-docs',
      prefix: 'handbook/',
      region: 'us-east-1',
      maxKeys: 5,
      secretRef: 'env://S3_CONNECTOR_CREDENTIALS'
    })
    const object = await reader.getObject({
      bucket: 'romeo-docs',
      key: objects[0]!.key,
      region: 'us-east-1',
      secretRef: 'env://S3_CONNECTOR_CREDENTIALS'
    })

    expect(objects).toEqual([{ key: 'handbook/private.md', sizeBytes: 15 }])
    expect(new TextDecoder().decode(object?.body)).toContain('private S3 notes')
    expect(new URL(calls[0]!.url).searchParams.get('X-Amz-Credential')).toContain('connector-specific-key')
    expect(JSON.stringify(calls)).not.toContain('connector-specific-secret')
  })

  it('resolves connector-specific S3 credentials from non-env managed secret values', async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, ...(init === undefined ? {} : { init }) })
      return new Response(
        [
          '<ListBucketResult>',
          '<IsTruncated>false</IsTruncated>',
          '<Contents><Key>handbook/vault.md</Key><Size>20</Size></Contents>',
          '</ListBucketResult>'
        ].join(''),
        { status: 200, headers: { 'content-type': 'application/xml' } }
      )
    })
    const reader = new S3HttpConnectorReader({
      accessKeyId: '',
      endpoint: 'https://s3.example.com',
      fetchImpl,
      secretAccessKey: '',
      secretResolver: {
        async check() {
          return { available: true, scheme: 'vault' }
        },
        async resolveValue(secretRef) {
          expect(secretRef).toBe('vault://connectors/s3/credentials')
          return {
            available: true,
            scheme: 'vault',
            value: JSON.stringify({ accessKeyId: 'vault-s3-key', secretAccessKey: 'vault-s3-secret' })
          }
        }
      }
    })

    const objects = await reader.listObjects({
      bucket: 'romeo-docs',
      prefix: 'handbook/',
      region: 'us-east-1',
      maxKeys: 5,
      secretRef: 'vault://connectors/s3/credentials'
    })

    expect(objects).toEqual([{ key: 'handbook/vault.md', sizeBytes: 20 }])
    expect(new URL(calls[0]!.url).searchParams.get('X-Amz-Credential')).toContain('vault-s3-key')
    expect(JSON.stringify(calls)).not.toContain('vault-s3-secret')
  })

  it('rejects malformed connector-specific S3 credential secrets before fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const reader = new S3HttpConnectorReader({
      accessKeyId: '',
      endpoint: 'https://s3.example.com',
      fetchImpl,
      secretAccessKey: '',
      secretResolver: new EnvironmentSecretResolver({ S3_CONNECTOR_CREDENTIALS: '{"accessKeyId":"missing-secret"}' })
    })

    await expect(
      reader.listObjects({
        bucket: 'romeo-docs',
        prefix: 'handbook/',
        region: 'us-east-1',
        maxKeys: 5,
        secretRef: 'env://S3_CONNECTOR_CREDENTIALS'
      })
    ).rejects.toMatchObject({ code: 'connector_s3_secret_ref_invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
