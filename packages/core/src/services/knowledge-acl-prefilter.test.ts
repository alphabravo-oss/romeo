import { describe, expect, it } from "vitest";

import {
  knowledgeAclCacheKey,
  prefilterKnowledgeCandidates,
  recheckKnowledgeAccess,
} from "./knowledge-acl-prefilter";

const candidates = [
  {
    sourceId: "source_a",
    documentId: "doc_allowed",
    aclRevision: "acl_2",
    syncedAt: "2026-08-14T10:00:00.000Z",
  },
  {
    sourceId: "source_a",
    documentId: "doc_secret",
    aclRevision: "acl_2",
    syncedAt: "2026-08-14T10:00:00.000Z",
  },
];

describe("knowledge ACL prefilter", () => {
  it("resolves allowed document IDs before rank and never post-filters", () => {
    const decision = prefilterKnowledgeCandidates({
      candidates,
      bindings: [
        binding("doc_allowed", "principal_1"),
        binding("doc_secret", "principal_other"),
      ],
      principalId: "principal_1",
      now: "2026-08-14T10:01:00.000Z",
      maxStalenessMs: 60_000,
      failClosedWhenStale: true,
    });
    expect(decision.allowed.map((item) => item.documentId)).toEqual([
      "doc_allowed",
    ]);
    expect(decision.deniedCount).toBe(1);
    expect(decision.reasonCode).toBe("knowledge_acl_denied");
    expect(JSON.stringify(decision)).not.toContain("principal_other");
  });

  it("fails closed on mid-run revoke and stale protected sources", () => {
    const revoked = recheckKnowledgeAccess({
      previouslyAllowed: [candidates[0]!],
      bindings: [],
      principalId: "principal_1",
      now: "2026-08-14T10:02:00.000Z",
      maxStalenessMs: 60_000,
    });
    expect(revoked).toMatchObject({
      allowed: [],
      reasonCode: "knowledge_acl_denied",
    });
    const stale = prefilterKnowledgeCandidates({
      candidates: [
        { ...candidates[0]!, syncedAt: "2026-08-14T09:00:00.000Z" },
      ],
      bindings: [binding("doc_allowed", "principal_1")],
      principalId: "principal_1",
      now: "2026-08-14T10:02:00.000Z",
      maxStalenessMs: 60_000,
      failClosedWhenStale: true,
    });
    expect(stale.reasonCode).toBe("knowledge_acl_stale");
    expect(
      knowledgeAclCacheKey({
        subjectId: "principal_1",
        groupRevision: "g1",
        grantRevision: "r1",
        aclRevision: "acl_2",
      }),
    ).toContain("acl_2");
  });
});

function binding(documentId: string, principalId: string) {
  return {
    sourceId: "source_a",
    documentId,
    principalId,
    permission: "read" as const,
    aclRevision: "acl_2",
    syncedAt: "2026-08-14T10:00:00.000Z",
  };
}
