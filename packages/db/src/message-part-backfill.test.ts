import { describe, expect, it, vi } from "vitest";

import { runMessagePartBackfill } from "./message-part-backfill";

describe("message part backfill runner", () => {
  it("is bounded, restartable, and reports explicit completion", async () => {
    const backfillLegacyMessageTextParts = vi
      .fn()
      .mockResolvedValueOnce({
        messagesCompleted: 2,
        partsReindexed: 3,
        remainingMessages: 1,
        textPartsCreated: 2,
        blockedMessages: 0,
      })
      .mockResolvedValueOnce({
        messagesCompleted: 1,
        partsReindexed: 1,
        remainingMessages: 0,
        textPartsCreated: 1,
        blockedMessages: 0,
      });

    await expect(
      runMessagePartBackfill({
        repository: { backfillLegacyMessageTextParts },
        batch: { maxMessages: 2, maxPartRows: 20 },
        maxBatches: 2,
      }),
    ).resolves.toEqual({
      batches: 2,
      completed: true,
      messagesCompleted: 3,
      partsReindexed: 4,
      remainingMessages: 0,
      textPartsCreated: 3,
      blockedMessages: 0,
    });
    expect(backfillLegacyMessageTextParts).toHaveBeenCalledTimes(2);
  });

  it("stops without spinning when a batch cannot make progress", async () => {
    const repository = {
      backfillLegacyMessageTextParts: vi.fn().mockResolvedValue({
        messagesCompleted: 0,
        partsReindexed: 0,
        remainingMessages: 1,
        textPartsCreated: 0,
        blockedMessages: 1,
      }),
    };
    const result = await runMessagePartBackfill({
      repository,
      batch: { maxMessages: 10, maxPartRows: 100 },
      maxBatches: 50,
    });
    expect(result).toMatchObject({ batches: 1, completed: false });
    expect(repository.backfillLegacyMessageTextParts).toHaveBeenCalledOnce();
  });
});
