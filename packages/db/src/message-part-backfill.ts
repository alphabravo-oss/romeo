import type {
  MessagePartBackfillBatchInput,
  MessagePartBackfillBatchResult,
} from "@romeo/core";

export interface MessagePartBackfillRepository {
  backfillLegacyMessageTextParts(
    input: MessagePartBackfillBatchInput,
  ): Promise<MessagePartBackfillBatchResult>;
}

export async function runMessagePartBackfill(input: {
  repository: MessagePartBackfillRepository;
  batch: MessagePartBackfillBatchInput;
  maxBatches: number;
  onBatch?: (result: MessagePartBackfillBatchResult) => void;
}): Promise<
  MessagePartBackfillBatchResult & { batches: number; completed: boolean }
> {
  if (!Number.isInteger(input.maxBatches) || input.maxBatches < 1)
    throw new Error("maxBatches must be a positive integer.");
  let batches = 0;
  let aggregate: MessagePartBackfillBatchResult = {
    messagesCompleted: 0,
    partsReindexed: 0,
    remainingMessages: 0,
    textPartsCreated: 0,
    blockedMessages: 0,
  };
  while (batches < input.maxBatches) {
    const result = await input.repository.backfillLegacyMessageTextParts(
      input.batch,
    );
    batches += 1;
    input.onBatch?.(result);
    aggregate = {
      messagesCompleted: aggregate.messagesCompleted + result.messagesCompleted,
      partsReindexed: aggregate.partsReindexed + result.partsReindexed,
      remainingMessages: result.remainingMessages,
      textPartsCreated: aggregate.textPartsCreated + result.textPartsCreated,
      blockedMessages: result.blockedMessages,
    };
    if (result.remainingMessages === 0 || result.messagesCompleted === 0) break;
  }
  return {
    ...aggregate,
    batches,
    completed: aggregate.remainingMessages === 0,
  };
}
