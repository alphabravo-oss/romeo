import type { RunEvent } from "@romeo/ai-runtime";

import type { RomeoRepository } from "../domain/repository";
import type { RunEventSequencer } from "./run-event-sequencer";
import type { PreparedRunStart } from "./run-service-contracts";

export async function persistRunRetrievalEvent(
  repository: RomeoRepository,
  sequencer: RunEventSequencer,
  input: {
    runId: string;
    citations: PreparedRunStart["citations"];
    safety: PreparedRunStart["knowledgeSafety"];
  },
): Promise<RunEvent[]> {
  if (input.citations.length === 0 && input.safety === undefined) return [];
  const event = await sequencer.create(repository, {
    runId: input.runId,
    type: "retrieval.completed",
    data: {
      citationCount: input.citations.length,
      citations: input.citations,
      ...(input.safety === undefined ? {} : { safety: input.safety }),
    },
  });
  await sequencer.persist(repository, [event]);
  return [event];
}
