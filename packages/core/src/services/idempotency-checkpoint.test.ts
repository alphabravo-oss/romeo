import { describe, expect, it } from "vitest";

import {
  recordCommandCheckpoint,
  recoverIdempotentCheckpoint,
} from "./idempotency-checkpoint";

describe("idempotency crash-before-receipt recovery", () => {
  it("replays a completed receipt and a side-effect checkpoint without repeating work", () => {
    const checkpoint = recordCommandCheckpoint(undefined, {
      receiptId: "receipt_1",
      operation: "images.generate",
      requestHash: "a".repeat(64),
      stage: "side_effect_completed",
      effectRef: { kind: "file", id: "file_1" },
    });
    expect(
      recoverIdempotentCheckpoint({
        receipt: {
          state: "completed",
          requestHash: "a".repeat(64),
          responseBody: { fileId: "file_1" },
        },
        checkpoint,
        requestHash: "a".repeat(64),
      }),
    ).toEqual({
      action: "replay",
      effectRef: { kind: "file", id: "file_1" },
    });
    expect(
      recoverIdempotentCheckpoint({
        receipt: { state: "in_progress", requestHash: "a".repeat(64) },
        checkpoint,
        requestHash: "a".repeat(64),
      }),
    ).toEqual({
      action: "replay",
      effectRef: { kind: "file", id: "file_1" },
    });
  });

  it("conflicts on shape drift and fails closed when a side effect started without a ref", () => {
    expect(
      recoverIdempotentCheckpoint({
        receipt: { state: "completed", requestHash: "a".repeat(64) },
        requestHash: "b".repeat(64),
      }),
    ).toEqual({ action: "conflict" });
    expect(
      recoverIdempotentCheckpoint({
        receipt: { state: "in_progress", requestHash: "a".repeat(64) },
        checkpoint: {
          receiptId: "receipt_1",
          operation: "runs.start",
          requestHash: "a".repeat(64),
          stage: "side_effect_started",
        },
        requestHash: "a".repeat(64),
      }),
    ).toEqual({
      action: "fail",
      code: "idempotency_checkpoint_incomplete",
    });
    expect(
      recoverIdempotentCheckpoint({
        receipt: { state: "in_progress", requestHash: "a".repeat(64) },
        checkpoint: {
          receiptId: "receipt_1",
          operation: "exports.execute",
          requestHash: "a".repeat(64),
          stage: "claimed",
        },
        requestHash: "a".repeat(64),
      }),
    ).toEqual({ action: "resume" });
  });
});
