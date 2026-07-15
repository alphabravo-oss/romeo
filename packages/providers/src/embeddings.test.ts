import { describe, expect, it } from 'vitest'

import { getEmbeddingAdapter } from './embedding-registry'
import { defaultProviderCapabilities } from './capabilities'
import type { ProviderInstance } from './types'

const openAiProvider: ProviderInstance = {
  id: 'provider_openai',
  orgId: 'org_default',
  type: 'openai-compatible',
  name: 'OpenAI-compatible',
  baseUrl: 'https://api.example.com/v1/',
  enabled: true,
  capabilities: defaultProviderCapabilities('openai-compatible')
}

const ollamaProvider: ProviderInstance = {
  ...openAiProvider,
  id: 'provider_ollama',
  type: 'ollama',
  name: 'Ollama',
  baseUrl: 'http://localhost:11434'
}

describe('provider embedding adapters', () => {
  it('calls OpenAI-compatible embeddings and normalizes usage', async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = []
    const result = await getEmbeddingAdapter('openai-compatible').embedTexts({
      provider: openAiProvider,
      model: 'text-embedding-3-small',
      texts: ['Romeo', 'quotas'],
      apiKey: 'sk_test',
      fetchImpl: async (input, init) => {
        calls.push(init === undefined ? { url: String(input) } : { url: String(input), init })
        return new Response(
          JSON.stringify({
            model: 'text-embedding-3-small',
            data: [{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }],
            usage: { prompt_tokens: 2, total_tokens: 2 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    })

    expect(calls[0]?.url).toBe('https://api.example.com/v1/embeddings')
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer sk_test' })
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ model: 'text-embedding-3-small', input: ['Romeo', 'quotas'] }))
    expect(result.dimensions).toBe(3)
    expect(result.embeddings).toEqual([[1, 0, 0], [0, 1, 0]])
    expect(result.usage?.inputTokens).toBe(2)
  })

  it('calls Ollama embed and rejects malformed vectors', async () => {
    await expect(
      getEmbeddingAdapter('ollama').embedTexts({
        provider: ollamaProvider,
        model: 'nomic-embed-text',
        texts: ['Romeo'],
        fetchImpl: async () => new Response(JSON.stringify({ embeddings: [[1], [2]] }), { status: 200 })
      })
    ).rejects.toThrow('unexpected embedding count')
  })
})
