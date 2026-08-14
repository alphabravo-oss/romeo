import { describe, expect, it } from "vitest";

import { documentFieldsFromStoredFile } from "./composer-tray-upload";

describe("documentFieldsFromStoredFile", () => {
  it("maps scanning files to tray scan progress and ready files to downloads", () => {
    const scanning = documentFieldsFromStoredFile({
      contentUrl: "/files/file_scan/content",
      createdAt: "2026-08-14T00:00:00.000Z",
      extraction: {
        attempts: 0,
        attemptedAt: null,
        characterCount: null,
        completedAt: null,
        confidence: null,
        failureCode: null,
        method: null,
        pageCount: 8,
        provider: null,
        quality: "unknown",
        status: "processing",
      },
      fileName: "brief.pdf",
      id: "file_scan",
      lifecycle: {
        attempts: 0,
        attachedAt: null,
        failureCode: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        retainedAt: null,
        retryable: false,
        schemaVersion: 1,
        state: "scanning",
        version: 1,
      },
      metadata: { transcript: "hello" },
      mimeType: "application/pdf",
      ownerId: "user_1",
      ownerType: "user",
      purpose: "chat_attachment",
      sha256: "abc",
      sizeBytes: 12,
      status: "scanning",
      updatedAt: "2026-08-14T00:00:00.000Z",
      workspaceId: "workspace_1",
    });
    expect(scanning).toMatchObject({
      downloadUrl: "/files/file_scan/content",
      fileId: "file_scan",
      pageCount: 8,
      percent: 70,
      status: "scanning",
      transcript: "hello",
    });
  });
});
