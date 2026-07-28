import { describe, expect, it } from "vitest";

import { parsePortableChat } from "./workspace-nav-portability";

describe("workspace navigation chat portability", () => {
  it("accepts exported chat envelopes and preserves reusable context", async () => {
    const file = jsonFile("conversation.json", {
      data: {
        chat: { title: "Imported title", modelId: "model_1" },
        messages: [
          {
            role: "user",
            content: "Review this",
            createdAt: "2026-07-18T12:00:00.000Z",
            citations: [
              {
                chunkId: "chunk_1",
                documentId: "document_1",
                title: "Source",
                sourceUri: "https://example.com/source",
              },
            ],
            attachments: [
              {
                dataBase64: "aGVsbG8=",
                fileName: "notes.txt",
                mimeType: "text/plain",
                retainedInContext: true,
                sizeBytes: 5,
              },
            ],
          },
        ],
      },
    });

    await expect(parsePortableChat(file)).resolves.toEqual({
      title: "Imported title",
      modelId: "model_1",
      messages: [
        {
          role: "user",
          content: "Review this",
          createdAt: "2026-07-18T12:00:00.000Z",
          citations: [
            {
              chunkId: "chunk_1",
              documentId: "document_1",
              title: "Source",
              sourceUri: "https://example.com/source",
            },
          ],
          attachments: [
            {
              dataBase64: "aGVsbG8=",
              fileName: "notes.txt",
              mimeType: "text/plain",
              retainedInContext: true,
              sizeBytes: 5,
            },
          ],
        },
      ],
    });
  });

  it("filters malformed portable records and falls back to the file name", async () => {
    const file = jsonFile("fallback.json", {
      messages: [
        null,
        { role: "invalid", content: "ignored" },
        { role: "assistant", content: "kept", attachments: [{}] },
      ],
    });

    await expect(parsePortableChat(file)).resolves.toEqual({
      title: "fallback",
      messages: [{ role: "assistant", content: "kept" }],
    });
  });
});

function jsonFile(name: string, value: unknown): File {
  return new File([JSON.stringify(value)], name, { type: "application/json" });
}
