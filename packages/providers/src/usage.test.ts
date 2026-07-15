import { describe, expect, it } from 'vitest'

import { normalizeProviderTokenUsage, usageFromOllamaPayload, usageFromOpenAiPayload } from './usage'

describe('provider usage normalization', () => {
  it('normalizes OpenAI-compatible chat completion usage payloads', () => {
    expect(usageFromOpenAiPayload({ usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } })).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      source: 'openai-compatible'
    })
  })

  it('normalizes OpenAI Responses-style usage payloads and derives totals', () => {
    expect(usageFromOpenAiPayload({ input_tokens: 4, output_tokens: 6 })).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
      source: 'openai-compatible'
    })
  })

  it('normalizes OpenAI Responses stream completion envelopes', () => {
    expect(usageFromOpenAiPayload({ type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 } } })).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
      source: 'openai-compatible'
    })
    expect(usageFromOpenAiPayload({ data: { response: { usage: { input_tokens: 3, output_tokens: 4 } } } })).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
      source: 'openai-compatible'
    })
  })

  it('normalizes Ollama final response token counts', () => {
    expect(usageFromOllamaPayload({ prompt_eval_count: 17, eval_count: 9 })).toEqual({
      inputTokens: 17,
      outputTokens: 9,
      totalTokens: 26,
      source: 'ollama'
    })
  })

  it('accepts existing Romeo token fields from custom adapters', () => {
    expect(normalizeProviderTokenUsage({ inputTokens: 2, outputTokens: 3 }, { source: 'custom' })).toEqual({
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      source: 'custom'
    })
  })

  it('rejects negative, fractional, and missing usage counts', () => {
    expect(normalizeProviderTokenUsage({ usage: { prompt_tokens: -1, completion_tokens: 1.5 } })).toBeUndefined()
    expect(normalizeProviderTokenUsage({ usage: { model: 'gpt-compatible' } })).toBeUndefined()
    expect(normalizeProviderTokenUsage(undefined)).toBeUndefined()
  })
})
