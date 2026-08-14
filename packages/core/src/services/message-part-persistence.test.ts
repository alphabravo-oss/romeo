import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { createSeedData } from "../repositories/seed-data";
import { attachMessageParts } from "./message-attachments";

const createdAt = "2026-08-14T12:00:00.000Z";

describe("typed message part persistence", () => {
  it("atomically writes nonblank text and omits a part for blank messages", async () => {
    const repository = new InMemoryRomeoRepository(createSeedData(createdAt));
    await repository.createMessage(message("msg_text", "hello"));
    await repository.createMessage(message("msg_blank", "", "assistant"));
    expect(await repository.listMessageParts("msg_text")).toMatchObject([
      { schemaVersion: 1, type: "text", text: "hello", position: 0 },
    ]);
    expect(await repository.listMessageParts("msg_blank")).toEqual([]);

    await expect(
      repository.transaction(async (transaction) => {
        await transaction.createMessage(message("msg_rolled_back", "hidden"));
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await repository.getMessage("msg_rolled_back")).toBeUndefined();
    expect(await repository.listMessageParts("msg_rolled_back")).toEqual([]);
  });

  it("synthesizes legacy text until a bounded restartable backfill completes", async () => {
    const seed = createSeedData(createdAt);
    seed.messages.push(
      message("legacy_b", "second"),
      message("legacy_a", "first"),
    );
    seed.messageParts.push({
      id: "attachment_b",
      messageId: "legacy_a",
      type: "attachment",
      content: "object-b",
      metadata: {
        fileName: "b.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
      },
    });
    const repository = new InMemoryRomeoRepository(seed);
    const projected = await attachMessageParts(repository, [seed.messages[1]!]);
    expect(projected[0]?.content).toBe("first");
    expect(projected[0]?.parts).toMatchObject([
      { schemaVersion: 1, type: "text", text: "first" },
    ]);
    expect(projected[0]?.attachments?.[0]?.fileName).toBe("b.txt");

    const first = await repository.backfillLegacyMessageTextParts({
      maxMessages: 1,
      maxPartRows: 10,
    });
    expect(first).toMatchObject({
      messagesCompleted: 1,
      remainingMessages: 1,
      textPartsCreated: 1,
    });
    const second = await repository.backfillLegacyMessageTextParts({
      maxMessages: 1,
      maxPartRows: 10,
    });
    expect(second).toMatchObject({
      messagesCompleted: 1,
      remainingMessages: 0,
      textPartsCreated: 1,
    });
    expect(await repository.listMessageParts("legacy_a")).toMatchObject([
      { id: "attachment_b" },
      { schemaVersion: 1, type: "text", position: 1, text: "first" },
    ]);
  });

  it("fails closed when an in-memory persisted typed row is corrupted", async () => {
    const seed = createSeedData(createdAt);
    seed.messageParts.push({
      id: "corrupted_part",
      messageId: "corrupted_message",
      schemaVersion: 2,
      type: "provider_blob",
    } as never);
    const repository = new InMemoryRomeoRepository(seed);
    await expect(
      repository.listMessageParts("corrupted_message"),
    ).rejects.toThrow("Invalid discriminator value");
  });
});

function message(
  id: string,
  content: string,
  role: "assistant" | "user" = "user",
) {
  return {
    id,
    chatId: "chat_welcome",
    role,
    content,
    createdAt,
  } as const;
}
