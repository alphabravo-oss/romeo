import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FileObject } from "../features/files";
import { FileLibraryCatalog } from "./FileLibraryCatalog";

const labels: Record<string, string> = {
  cancel: "Cancel",
  fileLifecycleAttached: "Attached",
  fileLifecycleDeleted: "Deleted",
  fileLifecycleExtracting: "Extracting",
  fileLifecycleFailed: "Failed security processing",
  fileLifecycleQuarantined: "Quarantined",
  fileLifecycleReady: "Ready",
  fileLifecycleRetained: "Retained",
  fileLifecycleScanning: "Scanning",
  fileLifecycleTranscoding: "Transcoding",
  fileLifecycleUpdating: "Updating file security status",
  fileLifecycleUploading: "Uploading",
  retry: "Retry",
  unexpectedAsyncFailure: "Unexpected failure",
};

vi.mock("../lib/i18n", () => ({
  useLocale: () => ({
    locale: "en",
    t: (key: string) => labels[key] ?? key,
  }),
}));

describe("file library lifecycle accessibility", () => {
  it("announces failed security state and prevents attachment until ready", () => {
    const html = render([fileFixture("failed")]);
    expect(html).toContain("Failed security processing");
    expect(html).toContain("disabled");
    expect(html).toContain("Retry fixture.txt");
    expect(html).toContain("Cancel fixture.txt");
    expect(html).toContain('aria-live="polite"');
  });

  it("keeps a ready file attachable without lifecycle retry controls", () => {
    const html = render([fileFixture("ready")]);
    expect(html).toContain("Ready");
    expect(html).not.toContain("Retry fixture.txt");
    expect(html).not.toContain("Cancel fixture.txt");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>.*fixture\.txt/su);
  });
});

function render(files: FileObject[]): string {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <FileLibraryCatalog
        files={files}
        onAttach={vi.fn()}
        onClose={vi.fn()}
        workspaceId="workspace_default"
      />
    </QueryClientProvider>,
  );
}

function fileFixture(status: FileObject["status"]): FileObject {
  return {
    id: "file_fixture",
    workspaceId: "workspace_default",
    ownerType: "user",
    ownerId: "user_dev_admin",
    fileName: "fixture.txt",
    mimeType: "text/plain",
    sizeBytes: 7,
    sha256: "a".repeat(64),
    purpose: "general",
    status,
    lifecycle: {
      schemaVersion: 1,
      state: status,
      version: 3,
      attempts: 1,
      retryable: status === "failed",
      failureCode: status === "failed" ? "file_lifecycle_failed" : null,
      nextAttemptAt: null,
      leaseExpiresAt: null,
      attachedAt: null,
      retainedAt: null,
    },
    metadata: {},
    extraction: {
      status: "succeeded",
      quality: "high",
      method: "utf8-text",
      attempts: 1,
      attemptedAt: "2026-08-14T12:00:00.000Z",
      completedAt: "2026-08-14T12:00:00.000Z",
      characterCount: 7,
      failureCode: null,
      provider: "native",
      pageCount: null,
      confidence: null,
    },
    contentUrl:
      status === "ready" ? "/api/v1/files/file_fixture/content" : null,
    createdAt: "2026-08-14T12:00:00.000Z",
    updatedAt: "2026-08-14T12:00:00.000Z",
  };
}
