import { describe, expect, it } from "vitest";

import { MessageSchema } from "./chat-schemas";
import {
  MessageContentSchema,
  MessagePartOutputSchema,
  MessagePartSchema,
} from "./message-parts";

describe("typed multimodal message parts", () => {
  it("accepts every versioned provider-neutral part kind", () => {
    const parts = [
      { schemaVersion: 1, type: "text", text: "Describe this", language: "en" },
      {
        schemaVersion: 1,
        type: "image_ref",
        fileId: "file-image",
        mediaType: "image/png",
        dimensions: { width: 1024, height: 768 },
        altText: "A diagram",
      },
      {
        schemaVersion: 1,
        type: "audio_ref",
        fileId: "file-audio",
        mediaType: "audio/wav",
        durationMs: 3_000,
        transcriptPartId: "part-text",
      },
      {
        schemaVersion: 1,
        type: "video_ref",
        fileId: "file-video",
        mediaType: "video/mp4",
        durationMs: 10_000,
        dimensions: { width: 1920, height: 1080 },
        keyframeFileIds: ["file-frame"],
      },
      {
        schemaVersion: 1,
        type: "document_ref",
        fileId: "file-document",
        fileName: "report.pdf",
        mediaType: "application/pdf",
        pageSelection: { start: 2, end: 4 },
      },
      {
        schemaVersion: 1,
        type: "tool_result_ref",
        toolCallId: "call-1",
        toolResultId: "result-1",
        outcome: "succeeded",
        safePreview: "Three records returned.",
      },
      {
        schemaVersion: 1,
        type: "artifact_ref",
        artifactId: "artifact-1",
        artifactVersion: 2,
        mediaType: "text/markdown",
        title: "Analysis",
        renderer: "markdown",
      },
      {
        schemaVersion: 1,
        type: "citation_ref",
        sourceId: "source-1",
        documentId: "document-1",
        chunkId: "chunk-1",
        title: "Policy",
      },
    ] as const;

    for (const part of parts) {
      expect(MessagePartSchema.safeParse(part).success).toBe(true);
    }
    expect(
      MessageContentSchema.safeParse({ schemaVersion: 1, parts }).success,
    ).toBe(true);
  });

  it("requires access-controlled references instead of inline bytes or URLs", () => {
    expect(
      MessagePartSchema.safeParse({
        schemaVersion: 1,
        type: "image_ref",
        fileId: "file-image",
        mediaType: "image/png",
        dataBase64: "secret-image-bytes",
      }).success,
    ).toBe(false);
    expect(
      MessagePartSchema.safeParse({
        schemaVersion: 1,
        type: "audio_ref",
        fileId: "https://untrusted.example/audio.wav",
        mediaType: "audio/wav",
        durationMs: 1_000,
      }).success,
    ).toBe(false);
  });

  it("enforces media, pixel, duration, page, and filename bounds", () => {
    expect(
      MessagePartSchema.safeParse({
        schemaVersion: 1,
        type: "image_ref",
        fileId: "file-image",
        mediaType: "image/svg+xml",
      }).success,
    ).toBe(false);
    expect(
      MessagePartSchema.safeParse({
        schemaVersion: 1,
        type: "image_ref",
        fileId: "file-image",
        mediaType: "image/png",
        dimensions: { width: 20_000, height: 20_000 },
      }).success,
    ).toBe(false);
    expect(
      MessagePartSchema.safeParse({
        schemaVersion: 1,
        type: "audio_ref",
        fileId: "file-audio",
        mediaType: "audio/wav",
        durationMs: 14_400_001,
      }).success,
    ).toBe(false);
    expect(
      MessagePartSchema.safeParse({
        schemaVersion: 1,
        type: "document_ref",
        fileId: "file-document",
        fileName: "../secret.pdf",
        mediaType: "application/pdf",
        pageSelection: { start: 5, end: 2 },
      }).success,
    ).toBe(false);
  });

  it("requires bounded ordered output identity", () => {
    const part = {
      schemaVersion: 1,
      type: "text",
      text: "Hello",
      id: "part-1",
      messageId: "message-1",
      position: 0,
      createdAt: "2026-08-14T00:00:00.000Z",
    } as const;
    expect(MessagePartOutputSchema.safeParse(part).success).toBe(true);
    expect(
      MessagePartOutputSchema.safeParse({ ...part, position: 10_000 }).success,
    ).toBe(false);
  });

  it("adds typed parts to message output without breaking legacy content", () => {
    expect(
      MessageSchema.safeParse({
        id: "message-1",
        chatId: "chat-1",
        role: "assistant",
        content: "Legacy projection",
        parts: [
          {
            schemaVersion: 1,
            type: "artifact_ref",
            id: "part-1",
            messageId: "message-1",
            position: 0,
            createdAt: "2026-08-14T00:00:00.000Z",
            artifactId: "artifact-1",
            artifactVersion: 1,
            mediaType: "text/markdown",
            title: "Report",
            renderer: "markdown",
          },
        ],
        createdAt: "2026-08-14T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
