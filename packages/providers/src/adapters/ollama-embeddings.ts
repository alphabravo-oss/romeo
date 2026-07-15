import type { EmbedTextsResult, EmbeddingProviderAdapter, ProviderTokenUsage } from '../types'
import { assertEmbeddingInput, parseEmbeddingMatrix, postJson } from './embedding-utils'
import { normalizeProviderTokenUsage } from '../usage'

export const ollamaEmbeddingAdapter: EmbeddingProviderAdapter = {
  kind: 'ollama',
  async embedTexts(input): Promise<EmbedTextsResult> {
    assertEmbeddingInput(input.texts)
    const request: Parameters<typeof postJson>[0] = {
      url: `${input.provider.baseUrl.replace(/\/$/u, '')}/api/embed`,
      body: { model: input.model, input: input.texts }
    }
    if (input.fetchImpl !== undefined) request.fetchImpl = input.fetchImpl
    if (input.signal !== undefined) request.signal = input.signal
    const payload = await postJson(request)
    const response = payload as { embeddings?: unknown; model?: unknown }
    const matrix = parseEmbeddingMatrix(response.embeddings, input.texts.length)
    const usage = usageFromPayload(response)
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
    return normalizeProviderTokenUsage(payload, { source: 'ollama' })
  } catch {
    return undefined
  }
}
