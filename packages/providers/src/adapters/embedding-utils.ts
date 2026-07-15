export class ProviderEmbeddingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderEmbeddingError'
  }
}

export function assertEmbeddingInput(texts: string[]): void {
  if (texts.length === 0) throw new ProviderEmbeddingError('At least one text is required for embedding.')
  if (texts.some((text) => text.length === 0)) throw new ProviderEmbeddingError('Embedding input text cannot be empty.')
}

export function parseEmbeddingMatrix(value: unknown, expectedCount: number): { dimensions: number; embeddings: number[][] } {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new ProviderEmbeddingError('Provider returned an unexpected embedding count.')
  }
  const embeddings = value.map((item) => {
    if (!Array.isArray(item) || item.length === 0 || item.some((number) => typeof number !== 'number' || !Number.isFinite(number))) {
      throw new ProviderEmbeddingError('Provider returned an invalid embedding vector.')
    }
    return item
  })
  const dimensions = embeddings[0]?.length ?? 0
  if (embeddings.some((embedding) => embedding.length !== dimensions)) {
    throw new ProviderEmbeddingError('Provider returned embedding vectors with mixed dimensions.')
  }
  return { dimensions, embeddings }
}

export async function postJson(input: {
  apiKey?: string
  body: Record<string, unknown>
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  url: string
}): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (input.apiKey !== undefined && input.apiKey.length > 0) headers.authorization = `Bearer ${input.apiKey}`
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(input.body)
  }
  if (input.signal !== undefined) init.signal = input.signal
  const response = await (input.fetchImpl ?? fetch)(input.url, init)
  if (!response.ok) throw new ProviderEmbeddingError(`Embedding request failed with HTTP ${response.status}.`)
  return response.json()
}
