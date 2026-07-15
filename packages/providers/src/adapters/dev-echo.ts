import type { StreamChatChunk, StreamChatInput } from '../types'

export async function* devEchoStream(input: StreamChatInput, prefix: string): AsyncIterable<StreamChatChunk> {
  const lastUserMessage = [...input.messages].reverse().find((message) => message.role === 'user')
  const text = `${prefix} ${lastUserMessage?.content ?? 'Ready.'}`

  for (const token of text.split(/(\s+)/).filter(Boolean)) {
    if (input.signal?.aborted === true) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 20))
    yield token
  }

  const inputTokens = estimateTokens(input.messages.map((message) => message.content).join('\n'))
  const outputTokens = estimateTokens(text)
  yield { type: 'usage', usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, source: 'dev-echo' } }
}

function estimateTokens(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return Math.max(1, Math.ceil(trimmed.length / 4))
}
