import type { RunEvent } from './events'

export function encodeSseEvent(event: RunEvent): string {
  return `event: ${event.type}\nid: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`
}

export function createSseStream(events: AsyncIterable<RunEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      for await (const event of events) {
        controller.enqueue(encoder.encode(encodeSseEvent(event)))
      }

      controller.close()
    }
  })
}
