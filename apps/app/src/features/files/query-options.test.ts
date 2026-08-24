import { describe, expect, it } from "vitest";

import {
  fileLifecycleRefreshInterval,
  fileLifecycleRefreshIntervalMs,
} from "./query-options";
import type { FileObject, FilePage } from "./types";

describe("file lifecycle query recovery", () => {
  it("polls while any file is pending and stops when every file is terminal", () => {
    expect(
      fileLifecycleRefreshInterval(page([fileFixture("quarantined")])),
    ).toBe(fileLifecycleRefreshIntervalMs);
    expect(fileLifecycleRefreshInterval(page([fileFixture("ready")]))).toBe(
      false,
    );
    expect(fileLifecycleRefreshInterval(undefined)).toBe(false);
  });
});

function page(items: FileObject[]): FilePage {
  return { items, hasMore: false, limit: 20, offset: 0, total: items.length };
}

function fileFixture(status: FileObject["status"]): FileObject {
  return {
    id: "file_fixture",
    workspaceId: "workspace_default",
    ownerType: "user",
    ownerId: "user_default",
    fileName: "fixture.txt",
    mimeType: "text/plain",
    sizeBytes: 7,
    sha256: "a".repeat(64),
    purpose: "general",
    status,
    lifecycle: {
      schemaVersion: 1,
      state: status,
      version: 1,
      attempts: status === "ready" ? 1 : 0,
      retryable: false,
      failureCode: null,
      nextAttemptAt: null,
      leaseExpiresAt: null,
      attachedAt: null,
      retainedAt: null,
    },
    metadata: {},
    extraction: {
      status: status === "ready" ? "succeeded" : "pending",
      quality: status === "ready" ? "high" : "unknown",
      method: "utf8-text",
      attempts: status === "ready" ? 1 : 0,
      attemptedAt: null,
      completedAt: null,
      characterCount: null,
      failureCode: null,
      provider: null,
      pageCount: null,
      confidence: null,
    },
    contentUrl:
      status === "ready" ? "/api/v1/files/file_fixture/content" : null,
    createdAt: "2026-08-14T12:00:00.000Z",
    updatedAt: "2026-08-14T12:00:00.000Z",
  };
}
