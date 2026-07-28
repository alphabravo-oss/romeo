export function chatCompletionChunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: "stop" | "tool_calls" | null = null,
) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export function createdSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
