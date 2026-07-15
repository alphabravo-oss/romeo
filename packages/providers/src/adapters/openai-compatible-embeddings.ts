import type { EmbedTextsResult, EmbeddingProviderAdapter, ProviderTokenUsage } from '../types'
import { assertEmbeddingInput, parseEmbeddingMatrix, postJson } from './embedding-utils'
import { normalizeProviderTokenUsage } from '../usage'

export const openAiCompatibleEmbeddingAdapter: EmbeddingProviderAdapter = {
  kind: 'openai-compatible',
  async embedTexts(input): Promise<EmbedTextsResult> {
    assertEmbeddingInput(input.texts)
    const request: Parameters<typeof postJson>[0] = {
      url: `${input.provider.baseUrl.replace(/\/$/u, '')}/embeddings`,
      body: { model: input.model, input: input.texts }
    }
    if (input.apiKey !== undefined) request.apiKey = input.apiKey
    if (input.fetchImpl !== undefined) request.fetchImpl = input.fetchImpl
    if (input.signal !== undefined) request.signal = input.signal
    const payload = await postJson(request)
    const response = payload as { data?: Array<{ embedding?: unknown }>; model?: unknown; usage?: unknown }
    const matrix = parseEmbeddingMatrix(response.data?.map((item) => item.embedding), input.texts.length)
    const usage = usageFromPayload(response.usage)
    return {
      model: typeof response.model === 'string' ? response.model : input.model,
      dimensions: matrix.dimensions,
      embeddings: matrix.embeddings,
      ...(usage === undefined ? {} : { usage })
    }
  }
}

function usageFromPayload(payload: unknown): ProviderTokenUsage | undefined {
  try {
    return normalizeProviderTokenUsage(payload, { source: 'openai-compatible' })
  } catch {
    return undefined
  }
}
