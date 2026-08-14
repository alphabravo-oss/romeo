import { describe, expect, it } from "vitest";

import type { KnowledgeSource } from "../features/knowledge/types";
import { summarizeKnowledgeQuality } from "./knowledge-quality";

const now = Date.parse("2026-08-13T12:00:00.000Z");

function source(
  id: string,
  input: Partial<KnowledgeSource> = {},
): KnowledgeSource {
  return {
    id,
    knowledgeBaseId: "kb_1",
    orgId: "org_1",
    workspaceId: "workspace_1",
    fileName: `${id}.txt`,
    mimeType: "text/plain",
    sizeBytes: 10,
    status: "indexed",
    metadata: {},
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    indexedAt: "2026-08-12T12:00:00.000Z",
    ...input,
  };
}

describe("summarizeKnowledgeQuality", () => {
  it("surfaces freshness, ingestion failures, chunks, and duplicate content", () => {
    const unknownDate = source("unknown-date");
    delete unknownDate.indexedAt;
    const summary = summarizeKnowledgeQuality(
      [
        source("healthy", { chunkCount: 4, contentHash: "same" }),
        source("duplicate", { chunkCount: 3, contentHash: "same" }),
        source("stale", { indexedAt: "2026-01-01T00:00:00.000Z" }),
        unknownDate,
        source("failed", { status: "failed" }),
        source("pending", { status: "pending" }),
      ],
      now,
    );

    expect(summary).toEqual({
      duplicateSources: 1,
      failedSources: 1,
      healthySources: 2,
      pendingSources: 1,
      staleSources: 2,
      totalChunks: 7,
    });
  });
});
