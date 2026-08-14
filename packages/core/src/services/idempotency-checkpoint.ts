import type { IdempotencyReceipt } from "../domain/idempotency";

export const IDEMPOTENT_OPERATIONS = [
  "images.generate",
  "runs.start",
  "exports.execute",
  "compare.sessions.start",
  "compute.jobs.create",
  "media.jobs.create",
  "table.exports.create",
] as const;
export type ExtendedIdempotentOperation = (typeof IDEMPOTENT_OPERATIONS)[number];

export type CommandCheckpointStage =
  | "claimed"
  | "side_effect_started"
  | "side_effect_completed"
  | "receipt_completed";

export interface CommandCheckpoint {
  receiptId: string;
  operation: ExtendedIdempotentOperation;
  requestHash: string;
  stage: CommandCheckpointStage;
  effectRef?: { kind: string; id: string };
}

export type CheckpointRecovery =
  | { action: "replay"; effectRef: { kind: string; id: string } }
  | { action: "resume" }
  | { action: "conflict" }
  | { action: "fail"; code: "idempotency_checkpoint_incomplete" };

export function recordCommandCheckpoint(
  current: CommandCheckpoint | undefined,
  next: CommandCheckpoint,
): CommandCheckpoint {
  if (current !== undefined && current.receiptId !== next.receiptId)
    throw new Error("Checkpoint receipt identity cannot change.");
  if (
    current?.effectRef !== undefined &&
    next.effectRef !== undefined &&
    (current.effectRef.kind !== next.effectRef.kind ||
      current.effectRef.id !== next.effectRef.id)
  )
    throw new Error("Checkpoint effect reference cannot change.");
  return {
    ...next,
    ...(current?.effectRef === undefined ? {} : { effectRef: current.effectRef }),
  };
}

export function recoverIdempotentCheckpoint(input: {
  receipt: Pick<IdempotencyReceipt, "state" | "requestHash" | "responseBody">;
  checkpoint?: CommandCheckpoint;
  requestHash: string;
}): CheckpointRecovery {
  if (input.receipt.requestHash !== input.requestHash)
    return { action: "conflict" };
  if (input.receipt.state === "completed") {
    const effectRef = input.checkpoint?.effectRef;
    if (effectRef === undefined) return { action: "conflict" };
    return { action: "replay", effectRef };
  }
  if (input.checkpoint?.stage === "side_effect_completed" && input.checkpoint.effectRef)
    return { action: "replay", effectRef: input.checkpoint.effectRef };
  if (
    input.checkpoint?.stage === "side_effect_started" &&
    input.checkpoint.effectRef === undefined
  )
    return { action: "fail", code: "idempotency_checkpoint_incomplete" };
  return { action: "resume" };
}
