import { describe, expect, it } from 'vitest'

import { AwsSecretsManagerResolver, AzureKeyVaultResolver, CloudSecretResolver, GcpSecretManagerResolver } from './cloud-secret-resolver'
import { parseManagedSecretRef } from './secret-refs'
import { EnvironmentSecretResolver, VaultSecretResolver } from './secret-resolver'

describe('secret references and resolvers', () => {
  it('accepts bounded environment references without exposing values', async () => {
    const parsed = parseManagedSecretRef('env://ROMEO_TOOL_API_KEY')
    const resolver = new EnvironmentSecretResolver({ ROMEO_TOOL_API_KEY: 'secret-value' })

    const check = await resolver.check('env://ROMEO_TOOL_API_KEY')

    expect(parsed).toEqual({ scheme: 'env', path: 'ROMEO_TOOL_API_KEY' })
    expect(check).toEqual({ available: true, scheme: 'env' })
    expect(JSON.stringify(check)).not.toContain('secret-value')
  })

  it('reports missing and empty environment references with stable failure codes', async () => {
    const resolver = new EnvironmentSecretResolver({ EMPTY_SECRET: '' })

    await expect(resolver.check('env://MISSING_SECRET')).resolves.toEqual({ available: false, failureCode: 'secret_not_found', scheme: 'env' })
    await expect(resolver.check('env://EMPTY_SECRET')).resolves.toEqual({ available: false, failureCode: 'secret_empty', scheme: 'env' })
  })

  it('rejects invalid environment secret reference shapes', () => {
    expect(() => parseManagedSecretRef('env://ROMEO_TOOL_API_KEY/extra')).toThrow('Secret reference must use a managed secret URI scheme.')
    expect(() => parseManagedSecretRef('env://1_INVALID')).toThrow('Secret reference must use a managed secret URI scheme.')
  })

  it('does not claim unsupported managed providers are available', async () => {
    const resolver = new EnvironmentSecretResolver({ ROMEO_TOOL_API_KEY: 'secret-value' })

    await expect(resolver.check('vault://tools/api-key')).resolves.toEqual({
      available: false,
      failureCode: 'secret_scheme_unsupported',
      scheme: 'vault'
    })
  })

  it('checks Vault KV metadata without exposing token values', async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = []
    const resolver = new VaultSecretResolver({
      address: 'https://vault.example.com',
      token: 'vault-token-value',
      namespace: 'admin',
      kvMount: 'kv',
      fetchImpl: async (input, init) => {
        calls.push(init === undefined ? { url: String(input) } : { url: String(input), init })
        return new Response('{}', { status: 200 })
      }
    })

    const check = await resolver.check('vault://tools/issue-tracker/api-key')

    expect(check).toEqual({ available: true, scheme: 'vault' })
    expect(calls[0]?.url).toBe('https://vault.example.com/v1/kv/metadata/tools/issue-tracker/api-key')
    expect(calls[0]?.init?.headers).toMatchObject({ 'x-vault-token': 'vault-token-value', 'x-vault-namespace': 'admin' })
    expect(JSON.stringify(check)).not.toContain('vault-token-value')
  })

  it('resolves Vault KV-v2 values for execution-only secret use', async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = []
    const resolver = new VaultSecretResolver({
      address: 'https://vault.example.com',
      token: 'vault-token-value',
      kvMount: 'kv',
      fetchImpl: async (input, init) => {
        calls.push(init === undefined ? { url: String(input) } : { url: String(input), init })
        return new Response(JSON.stringify({ data: { data: { accessKeyId: 'vault-key', secretAccessKey: 'vault-secret' } } }), { status: 200 })
      }
    })

    const resolution = await resolver.resolveValue('vault://connectors/s3/credentials')

    expect(resolution.available).toBe(true)
    expect(JSON.parse(resolution.value ?? '{}')).toEqual({ accessKeyId: 'vault-key', secretAccessKey: 'vault-secret' })
    expect(calls[0]?.url).toBe('https://vault.example.com/v1/kv/data/connectors/s3/credentials')
    expect(calls[0]?.init?.headers).toMatchObject({ 'x-vault-token': 'vault-token-value' })
  })

  it('maps Vault metadata failures to stable failure codes', async () => {
    const resolverForStatus = (status: number) =>
      new VaultSecretResolver({
        address: 'https://vault.example.com',
        token: 'vault-token-value',
        fetchImpl: async () => new Response('{}', { status })
      })

    await expect(resolverForStatus(404).check('vault://tools/api-key')).resolves.toEqual({
      available: false,
      failureCode: 'secret_not_found',
      scheme: 'vault'
    })
    await expect(resolverForStatus(403).check('vault://tools/api-key')).resolves.toEqual({
      available: false,
      failureCode: 'secret_access_denied',
      scheme: 'vault'
    })
    await expect(resolverForStatus(500).check('vault://tools/api-key')).resolves.toEqual({
      available: false,
      failureCode: 'secret_resolver_error',
      scheme: 'vault'
    })
  })

  it('reports misconfigured Vault and unsupported refs without network checks', async () => {
    const resolver = new VaultSecretResolver({
      address: '',
      token: '',
      fetchImpl: async () => {
        throw new Error('should not fetch')
      }
    })

    await expect(resolver.check('vault://tools/api-key')).resolves.toEqual({
      available: false,
      failureCode: 'secret_resolver_misconfigured',
      scheme: 'vault'
    })
    await expect(resolver.check('env://ROMEO_TOOL_API_KEY')).resolves.toEqual({
      available: false,
      failureCode: 'secret_scheme_unsupported',
      scheme: 'env'
    })
  })

  it('checks AWS Secrets Manager metadata without returning secret material', async () => {
    const calls: Array<{ body: BodyInit | null | undefined; headers: HeadersInit | undefined; url: string }> = []
    const resolver = new AwsSecretsManagerResolver({
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-access-key',
      sessionToken: 'session-token',
      region: 'us-east-1',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: init?.headers, body: init?.body })
        return new Response('{}', { status: 200 })
      }
    })

    const check = await resolver.check('aws-sm://tools/issue-tracker/api-key')

    expect(check).toEqual({ available: true, scheme: 'aws-sm' })
    expect(calls[0]?.url).toBe('https://secretsmanager.us-east-1.amazonaws.com/')
    expect(calls[0]?.body).toBe(JSON.stringify({ SecretId: 'tools/issue-tracker/api-key' }))
    expect(calls[0]?.headers).toMatchObject({
      'x-amz-date': '20260102T030405Z',
      'x-amz-security-token': 'session-token',
      'x-amz-target': 'secretsmanager.DescribeSecret'
    })
    expect(String((calls[0]?.headers as Record<string, string>).authorization)).toContain('Credential=access-key/20260102/us-east-1/secretsmanager/aws4_request')
    expect(JSON.stringify(check)).not.toContain('secret-access-key')
  })

  it('resolves AWS Secrets Manager SecretString values for execution-only use', async () => {
    const calls: Array<{ body: BodyInit | null | undefined; headers: HeadersInit | undefined; url: string }> = []
    const resolver = new AwsSecretsManagerResolver({
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-access-key',
      region: 'us-east-1',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: init?.headers, body: init?.body })
        return new Response(JSON.stringify({ SecretString: '{"accessKeyId":"aws-key","secretAccessKey":"aws-secret"}' }), { status: 200 })
      }
    })

    const resolution = await resolver.resolveValue('aws-sm://connectors/s3/credentials')

    expect(resolution).toEqual({ available: true, scheme: 'aws-sm', value: '{"accessKeyId":"aws-key","secretAccessKey":"aws-secret"}' })
    expect(calls[0]?.body).toBe(JSON.stringify({ SecretId: 'connectors/s3/credentials' }))
    expect(calls[0]?.headers).toMatchObject({ 'x-amz-target': 'secretsmanager.GetSecretValue' })
    expect(JSON.stringify(calls)).not.toContain('aws-secret')
  })

  it('maps AWS Secrets Manager metadata failures to stable codes', async () => {
    const resolverForStatus = (status: number, body: object = {}) =>
      new AwsSecretsManagerResolver({
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-access-key',
        region: 'us-east-1',
        fetchImpl: async () => new Response(JSON.stringify(body), { status })
      })

    await expect(resolverForStatus(400, { __type: 'ResourceNotFoundException' }).check('aws-sm://tools/api-key')).resolves.toEqual({
      available: false,
      failureCode: 'secret_not_found',
      scheme: 'aws-sm'
    })
    await expect(resolverForStatus(403).check('aws-sm://tools/api-key')).resolves.toEqual({
      available: false,
      failureCode: 'secret_access_denied',
      scheme: 'aws-sm'
    })
    await expect(resolverForStatus(500).check('aws-sm://tools/api-key')).resolves.toEqual({
      available: false,
      failureCode: 'secret_resolver_error',
      scheme: 'aws-sm'
    })
  })

  it('checks GCP Secret Manager metadata using bearer auth only', async () => {
    const calls: Array<{ headers: HeadersInit | undefined; url: string }> = []
    const resolver = new GcpSecretManagerResolver({
      accessToken: 'gcp-token',
      projectId: 'romeo-prod1',
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: init?.headers })
        return new Response('{}', { status: 200 })
      }
    })

    const check = await resolver.check('gcp-sm://tool-api-key')

    expect(check).toEqual({ available: true, scheme: 'gcp-sm' })
    expect(calls[0]?.url).toBe('https://secretmanager.googleapis.com/v1/projects/romeo-prod1/secrets/tool-api-key')
    expect(calls[0]?.headers).toMatchObject({ authorization: 'Bearer gcp-token' })
    expect(JSON.stringify(check)).not.toContain('gcp-token')
  })

  it('resolves GCP Secret Manager latest secret payloads for execution-only use', async () => {
    const calls: Array<{ headers: HeadersInit | undefined; url: string }> = []
    const resolver = new GcpSecretManagerResolver({
      accessToken: 'gcp-token',
      projectId: 'romeo-prod1',
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: init?.headers })
        return new Response(JSON.stringify({ payload: { data: Buffer.from('gcp-secret-value').toString('base64') } }), { status: 200 })
      }
    })

    const resolution = await resolver.resolveValue('gcp-sm://s3-credentials')

    expect(resolution).toEqual({ available: true, scheme: 'gcp-sm', value: 'gcp-secret-value' })
    expect(calls[0]?.url).toBe('https://secretmanager.googleapis.com/v1/projects/romeo-prod1/secrets/s3-credentials/versions/latest:access')
    expect(calls[0]?.headers).toMatchObject({ authorization: 'Bearer gcp-token' })
  })

  it('checks Azure Key Vault secret version metadata without reading secret values', async () => {
    const calls: Array<{ headers: HeadersInit | undefined; url: string }> = []
    const resolver = new AzureKeyVaultResolver({
      accessToken: 'azure-token',
      vaultUrl: 'https://romeo.vault.azure.net',
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: init?.headers })
        return new Response(JSON.stringify({ value: [{ id: 'metadata-only' }] }), { status: 200 })
      }
    })

    const check = await resolver.check('azure-kv://tool-api-key')

    expect(check).toEqual({ available: true, scheme: 'azure-kv' })
    expect(calls[0]?.url).toBe('https://romeo.vault.azure.net/secrets/tool-api-key/versions?api-version=7.5')
    expect(calls[0]?.headers).toMatchObject({ authorization: 'Bearer azure-token' })
    expect(JSON.stringify(check)).not.toContain('azure-token')
  })

  it('resolves Azure Key Vault secret values for execution-only use', async () => {
    const calls: Array<{ headers: HeadersInit | undefined; url: string }> = []
    const resolver = new AzureKeyVaultResolver({
      accessToken: 'azure-token',
      vaultUrl: 'https://romeo.vault.azure.net',
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: init?.headers })
        return new Response(JSON.stringify({ value: '{"accessKeyId":"azure-key","secretAccessKey":"azure-secret"}' }), { status: 200 })
      }
    })

    const resolution = await resolver.resolveValue('azure-kv://s3-credentials')

    expect(resolution).toEqual({ available: true, scheme: 'azure-kv', value: '{"accessKeyId":"azure-key","secretAccessKey":"azure-secret"}' })
    expect(calls[0]?.url).toBe('https://romeo.vault.azure.net/secrets/s3-credentials?api-version=7.5')
    expect(calls[0]?.headers).toMatchObject({ authorization: 'Bearer azure-token' })
  })

  it('routes cloud secret refs by scheme and rejects unsafe cloud refs', async () => {
    const resolver = new CloudSecretResolver({
      aws: new AwsSecretsManagerResolver({
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-access-key',
        region: 'us-east-1',
        fetchImpl: async () => new Response('{}', { status: 200 })
      }),
      gcp: new GcpSecretManagerResolver({
        accessToken: 'gcp-token',
        projectId: 'romeo-prod1',
        fetchImpl: async () => new Response('{}', { status: 404 })
      }),
      azure: new AzureKeyVaultResolver({
        accessToken: 'azure-token',
        vaultUrl: 'https://romeo.vault.azure.net',
        fetchImpl: async () => new Response('{}', { status: 403 })
      })
    })

    await expect(resolver.check('aws-sm://tools/api-key')).resolves.toEqual({ available: true, scheme: 'aws-sm' })
    await expect(resolver.check('gcp-sm://missing-secret')).resolves.toEqual({
      available: false,
      failureCode: 'secret_not_found',
      scheme: 'gcp-sm'
    })
    await expect(resolver.check('azure-kv://denied-secret')).resolves.toEqual({
      available: false,
      failureCode: 'secret_access_denied',
      scheme: 'azure-kv'
    })
    await expect(resolver.check('vault://tools/api-key')).resolves.toEqual({
      available: false,
      failureCode: 'secret_scheme_unsupported',
      scheme: 'vault'
    })
    await expect(resolver.check('gcp-sm://../bad')).resolves.toEqual({
      available: false,
      failureCode: 'invalid_secret_ref',
      scheme: 'gcp-sm'
    })
  })
})
