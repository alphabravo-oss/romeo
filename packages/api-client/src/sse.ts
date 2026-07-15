export interface ServerSentEvent {
  event: string
  data: unknown
}

export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<ServerSentEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        const event = parseSseChunk(chunk)
        if (event) yield event
      }
    }

    buffer += decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function parseSseChunk(chunk: string): ServerSentEvent | undefined {
  let event = 'message'
  const data: string[] = []

  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }

  if (data.length === 0) return undefined
  return { event, data: JSON.parse(data.join('\n')) as unknown }
}
