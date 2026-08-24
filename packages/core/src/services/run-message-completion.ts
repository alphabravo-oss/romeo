import type { RunEvent } from "@romeo/ai-runtime";

import type { RomeoRepository } from "../domain/repository";
import type { RunEventSequencer } from "./run-event-sequencer";

export async function persistSafeMessageCompleted(input: {
  repository: RomeoRepository;
  sequencer: RunEventSequencer;
  event: RunEvent;
  content: string;
}): Promise<void> {
  const completed = await input.sequencer.assign(input.repository, {
    ...input.event,
    data: safeMessageCompletedData(input.event.data, input.content),
  });
  await input.sequencer.append(input.repository, [completed]);
}

function safeMessageCompletedData(data: unknown, content: string): unknown {
  if (data === null || typeof data !== "object" || Array.isArray(data))
    return { role: "assistant", content };
  const {
    content: _content,
    text: _text,
    ...metadata
  } = data as Record<string, unknown>;
  return { ...metadata, content };
}
