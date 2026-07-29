import { describe, expect, it } from "vitest";

import {
  parsePortableChat,
  portableChatImportLimits,
  PortableChatImportError,
} from "./workspace-nav-portability";

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

  it("rejects malformed records instead of silently creating a partial chat", async () => {
    const file = jsonFile("fallback.json", {
      messages: [
        null,
        { role: "invalid", content: "ignored" },
        { role: "assistant", content: "kept", attachments: [{}] },
      ],
    });

    await expectImportError(file, "invalid_message");
  });

  it("accepts the supported flat legacy shape and normalizes its title", async () => {
    const file = jsonFile("fallback.json", {
      title: "  Legacy title  ",
      messages: [{ role: "assistant", content: "kept" }],
    });
    await expect(parsePortableChat(file)).resolves.toEqual({
      title: "Legacy title",
      messages: [{ role: "assistant", content: "kept" }],
    });
  });

  it.each([
    ["no_messages", jsonFile("empty.json", { messages: [] }), "no_messages"],
    [
      "invalid_timestamp",
      jsonFile("time.json", {
        messages: [{ role: "user", content: "hello", createdAt: "not-a-time" }],
      }),
      "invalid_timestamp",
    ],
    [
      "invalid_attachment",
      jsonFile("attachment.json", {
        messages: [
          {
            role: "user",
            content: "hello",
            attachments: [
              {
                dataBase64: "***",
                fileName: "../secret.txt",
                mimeType: "text/plain",
                sizeBytes: 3,
              },
            ],
          },
        ],
      }),
      "invalid_attachment",
    ],
    [
      "invalid_citation",
      jsonFile("citation.json", {
        messages: [
          {
            role: "assistant",
            content: "hello",
            citations: [{ chunkId: "chunk", title: "missing document" }],
          },
        ],
      }),
      "invalid_citation",
    ],
  ])("returns a typed %s import failure", async (_name, file, code) => {
    await expectImportError(file, code);
  });

  it("rejects files before reading when the outer payload is too large", async () => {
    const oversized = jsonFile("oversized.json", { messages: [] });
    Object.defineProperty(oversized, "size", {
      value: portableChatImportLimits.fileBytes + 1,
    });
    await expectImportError(oversized, "file_too_large");
  });
});

async function expectImportError(file: File, code: string) {
  try {
    await parsePortableChat(file);
    throw new Error("Expected import to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(PortableChatImportError);
    expect((error as PortableChatImportError).code).toBe(code);
  }
}

function jsonFile(name: string, value: unknown): File {
  return new File([JSON.stringify(value)], name, { type: "application/json" });
}
