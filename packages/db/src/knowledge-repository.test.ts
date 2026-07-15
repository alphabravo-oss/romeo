import { describe, expect, it } from "vitest";

import {
  toKnowledgeBaseRecord,
  toKnowledgeChunkRecord,
  toKnowledgeSourceRecord,
} from "./knowledge-repository";

describe("knowledge repository mappers", () => {
  it("maps optional knowledge base descriptions", () => {
    const knowledgeBase = toKnowledgeBaseRecord({
      id: "kb_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      name: "Policies",
      description: null,
      createdBy: "user_1",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
    });

    expect(knowledgeBase).toEqual({
      id: "kb_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      name: "Policies",
      createdBy: "user_1",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:05:00.000Z",
    });
  });

  it("maps source lifecycle fields and normalizes unknown status", () => {
    const source = toKnowledgeSourceRecord({
      id: "source_1",
      knowledgeBaseId: "kb_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      fileName: "policy.md",
      mimeType: "text/markdown",
      sizeBytes: 128,
      status: "stalled",
      objectKey: "knowledge/source_1/policy.md",
      chunkCount: 2,
      contentHash: "sha256:abc",
      indexedAt: null,
      metadata: { visibility: "workspace", labels: ["policy"] },
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
    });

    expect(source).toMatchObject({
      id: "source_1",
      status: "failed",
      objectKey: "knowledge/source_1/policy.md",
      chunkCount: 2,
      contentHash: "sha256:abc",
      metadata: { visibility: "workspace", labels: ["policy"] },
    });
    expect(source.indexedAt).toBeUndefined();
  });

  it("maps chunks with metadata and stable timestamps", () => {
    const chunk = toKnowledgeChunkRecord({
      id: "chunk_1",
      knowledgeBaseId: "kb_1",
      sourceId: "source_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      sequence: 1,
      content: "Retention policy text.",
      tokenCount: 4,
      metadata: { heading: "Retention" },
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(chunk).toEqual({
      id: "chunk_1",
      knowledgeBaseId: "kb_1",
      sourceId: "source_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      sequence: 1,
      content: "Retention policy text.",
      tokenCount: 4,
      metadata: { heading: "Retention" },
      createdAt: "2026-06-27T00:00:00.000Z",
    });
  });
});
